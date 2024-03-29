import Path                    from "path"
import {existsSync, statSync } from "fs"
import mime                    from "mime"
import { appendFile, copyFile, mkdir, readdir, readFile, rm, stat, unlink, writeFile } from "fs/promises"
import crypto                  from "crypto"
import lockfile                from "proper-lockfile"
import patients                from "../data/db"
import config                  from "../config"
import { HttpError }           from "./errors"
import { EHI }                 from "../index"
import { getPath, getPrefixedFilePath, humanName, wait } from "./utils"



async function lock(path: string): Promise<() => Promise<void>> {
    await lockfile.lock(path, {
        realpath: false,
        retries: {
            unref: true,
            minTimeout: 20,
            retries: 100,
            factor: 1
        }
    });
    return () => lockfile.unlock(path, { realpath: false });
}


export class ExportJob
{
    readonly id: string;

    readonly patient: {
        id: string
        name: string
    };

    manifest: EHI.ExportManifest | null = null;

    status: EHI.ExportJobStatus = "awaiting-input";

    readonly path: string;

    protected createdAt: number = 0;

    protected completedAt: number = 0;
    
    protected parameters: EHI.ExportJobInformationParameters = {

        // Electronic Records
        visits           : { group: 1, enabled: false, name: "Clinic Visits"     },
        labs             : { group: 1, enabled: false, name: "Lab Reports"       },
        billing          : { group: 1, enabled: false, name: "Billing Records"   },
        medicalRecord    : { group: 1, enabled: false, name: "Other Records", from: false, to: false },
        
        // Other Records and Documents
        dischargeSummary : { group: 2, enabled: false, name: "Discharge Summary" },
        operative        : { group: 2, enabled: false, name: "Operative Reports" },
        pathology        : { group: 2, enabled: false, name: "Pathology Reports" },
        radiology        : { group: 2, enabled: false, name: "Radiology Reports" },
        photographs      : { group: 2, enabled: false, name: "Photographs"       },
        other            : { group: 2, enabled: false, name: "Other"             },
    };

    protected authorizations: EHI.ExportJobAuthorizations = {
        hiv             : { value: false, name: "HIV test results" },
        alcoholAndDrug  : { value: false, name: "Alcohol and Drug Abuse Records" },
        mentalHealth    : { value: false, name: "Details of Mental Health Diagnosis and/or Treatment" },
        confidential    : { value: false, name: "Confidential Communications with a Licensed Social Worker" },
        domesticViolence: { value: false, name: "Details of Domestic Violence Victims Counseling" },
        sexualAssault   : { value: false, name: "Details of Sexual Assault Counseling" },
        genetic         : { value: ""   , name: "Genetic Screening" },
        other           : { value: ""   , name: "Other(s)" }
    };

    /**
     * Custom attachments (if any)
     */
    protected attachments: fhir4.Attachment[];

    autoApprove = false

    /**
     * @param patientId The ID of the exported patient
     */
    public static async create(patientId: string)
    {
        return new ExportJob(patientId).save()
    }

    public async destroy()
    {
        if (!statSync(this.path, { throwIfNoEntry: false })?.isDirectory()) {
            throw new HttpError(`Unable to destroy job with id '${this.id}'.`).status(404)
        }

        const release = await lock(this.path)
        await rm(this.path, { recursive: true, maxRetries: 10, force: true })
        await release()
        return this;
    }

    /**
     * Delete a job by ID if:
     * - The job has been completed more than `completedJobLifetimeMinutes` minutes ago
     * - The job started more than `jobMaxLifetimeMinutes` minutes ago and is still pending
     * Note that jobs having "in-review" status will NOT be deleted
     */
    public static async destroyIfNeeded(id: string)
    {
        const job = await ExportJob.byId(id)
        switch (job.status) {
            case "rejected":
                await job.destroy()
            break;
            case "approved":
                if (Date.now() - job.completedAt > config.completedJobLifetimeMinutes * 60000) {
                    await job.destroy()
                }
            break;
            case "retrieved":
            case "awaiting-input":
                if (Date.now() - job.createdAt > config.jobMaxLifetimeMinutes * 60000) {
                    await job.destroy()
                }
            break;
        }
    }

    public static async byId(id: string)
    {
        const path = Path.join(config.jobsDir, id, "job.json")

        if (!statSync(path, { throwIfNoEntry: false })?.isFile()) {
            throw new HttpError("Export job not found!").status(404)
        }

        const release = await lock(Path.join(config.jobsDir, id))
        
        try {
            var data = await readFile(path, { flag: "r+", encoding: "utf8" })
        } catch {
            await release()
            throw new HttpError("Export job not readable!").status(500)
        }
        
        try {
            var json = JSON.parse(data)
        } catch (e) {
            await release()
            throw new HttpError("Export job corrupted! Failed to parse data from %s as JSON: %s; input: %j", path, e, data).status(500)
        }
        
        try {
            var job = new ExportJob(json.patient.id, json.id)
            Object.assign(job, json)
        } catch (e) {
            await release()
            throw new HttpError("Export job could not be loaded %s", e).status(500)
        }
        
        await release()
        return job
    }

    /**
     * NOTE: The constructor is protected because it is not supposed to be
     * called directly from outside this class. The reason is that one would
     * also want to save the new instance to a file and that is async task but
     * constructors cannot be async. `ExportManager.create()` can be used instead
     * @param patientId The ID of the exported patient
     */
    protected constructor(patientId: string, _jobId?: string)
    {
        this.id = _jobId || crypto.randomBytes(8).toString("hex")
        this.createdAt = Date.now()
        const pt = patients.get(patientId)!.patient as fhir4.Patient
        this.patient = {
            id: patientId,
            name: humanName(pt)
        }
        this.path = Path.join(config.jobsDir, this.id)
        this.attachments = [];
    }

    protected shouldExportResource(resource: fhir4.Resource): boolean
    {
        function isBefore(path: string, d: string) {
            return new Date(getPath(resource, path) || 0) <= new Date(d)
        }

        function isAfter(path: string, d: string) {
            return new Date(getPath(resource, path) || 0) >= new Date(d)
        }

        function check(param: EHI.ExportJobInformationParameter | undefined, fromPath: string, toPath: string) {
            const { enabled, from, to } = param || {}
            if (!enabled) {
                return false
            }

            if (from && !isAfter(fromPath, from)) {
                return false
            }

            if (to && !isBefore(toPath, to)) {
                return false
            }
            
            return true
        }
        
        switch (resource.resourceType) {

            case "Patient":
            case "Practitioner":
            case "Organization":
                return true;

            case "Encounter":
                return check(this.parameters.visits, "period.start", "period.end")
            case "Procedure":
                return check(this.parameters.visits, "performedPeriod.start", "performedPeriod.end")
            case "Claim":
                return check(this.parameters.billing, "billablePeriod.start", "billablePeriod.end")
            case "ExplanationOfBenefit":
                return check(this.parameters.billing, "billablePeriod.start", "billablePeriod.end")

            case "DiagnosticReport": // Any DiagnosticReports but labs are opt out
                {
                    const isLab = (resource as fhir4.DiagnosticReport).category?.some(
                        c => c.coding?.some(x => (
                            x.system === "http://terminology.hl7.org/CodeSystem/v2-0074" &&
                            x.code === "LAB"
                        )));

                    if (isLab) {
                        return check(this.parameters.labs, "effectiveDateTime", "effectiveDateTime")
                    }

                    return true
                }

            case "Observation": // Any Observations but labs are opt out
                {
                    const isLab = (resource as fhir4.Observation).category?.some(
                        c => c.coding?.some(x => (
                            x.system === "http://terminology.hl7.org/CodeSystem/observation-category" &&
                            x.code === "laboratory"
                        )));

                    if (isLab) {
                        return check(this.parameters.labs, "effectiveDateTime", "effectiveDateTime")
                    }

                    return true
                }
            
            // Include everything else if "medicalRecord" is on
            default:
                return !!this.parameters.medicalRecord?.enabled;
        }
    }

    public async kickOff(baseUrl: string, noForm = false)
    {
        this.status = "requested"
        await this.save()
        
        const patientPath   = patients.get(this.patient.id)!.file
        const patientData   = await readFile(patientPath, "utf8")
        const patientBundle = JSON.parse(patientData) as fhir4.Bundle

        // Start with empty manifest
        const manifest = {
            transactionTime: new Date(this.createdAt).toISOString(),
            requiresAccessToken: true,
            output: [] as any[],
            error: [] as any[]
        };

        // Create a function add every single resource
        const addOutputEntry = async <T extends fhir4.Resource>(resource: T, force = false) => {
            if (force || this.shouldExportResource(resource)) {
                const { resourceType } = resource
                const destination = Path.join(this.path, resourceType + ".ndjson")
                await appendFile(destination, JSON.stringify(resource) + "\n")

                let fileEntry = manifest.output.find(x => x.type === resourceType)
                if (!fileEntry) {
                    manifest.output.push({
                        type : resourceType,
                        url  : `${baseUrl}/jobs/${this.id}/download/${resourceType}.ndjson`,
                        count: 1
                    })
                } else {
                    fileEntry.count += 1;
                }
            }
        };

        // Try adding every resource from the transaction bundle
        for (const entry of patientBundle.entry!) {
            await addOutputEntry(entry.resource!, noForm && config.fullExportWithoutForm)
            await wait(config.jobThrottle)
        }

        this.completedAt = Date.now()
        this.manifest = manifest
        this.status = this.autoApprove ? "approved" : "retrieved"

        if (config.addDefaultAttachments === "always" || (config.addDefaultAttachments === "auto" && this.autoApprove)) {
            await this.addDefaultAttachments(baseUrl)
        } else {
            await this.save()
        }
    }

    async save()
    {
        const release = await lock(this.path)
        if (!existsSync(this.path)) {
            await mkdir(this.path)
        }

        await writeFile(
            Path.join(this.path, `job.json`),
            JSON.stringify(this, null, 4),
            { flag: "w+", encoding: "utf8" }
        );
        await release()
        return this;
    }

    public toJSON(): EHI.ExportJob
    {
        return {
            id            : this.id,
            patient       : this.patient,
            manifest      : this.manifest,
            status        : this.status,
            createdAt     : this.createdAt,
            completedAt   : this.completedAt,
            parameters    : this.parameters,
            authorizations: this.authorizations,
            attachments   : this.attachments,
            autoApprove   : this.autoApprove
        }
    }

    public async customize(
        parameters?: EHI.ExportJobInformationParameters,
        authorizations?: EHI.ExportJobAuthorizations
    ) {
        if (this.status !== "awaiting-input") {
            throw new HttpError('Exports job already customized').status(400)
        }

        if (parameters) {
            this.parameters = parameters
        }

        if (authorizations) {
            this.authorizations = authorizations
        }

        if (parameters || authorizations) {
            await this.save()
        }

        return this
    }

    public async addAttachment(attachment: Express.Multer.File, baseUrl: string) {
        if (this.status !== "retrieved") {
            throw new HttpError(`Cannot add attachments to export in "${this.status}" state`).status(400)
        }
        const release = await lock(this.path)
        const src  = Path.join(__dirname, "..", attachment.path)
        const dst  = Path.join(this.path, "attachments")
        const path = getPrefixedFilePath(dst, attachment.originalname)
        const filename = Path.basename(path)
        await mkdir(dst, { recursive: true });
        await copyFile(src, path);
        this.attachments.push({
            title: filename,
            contentType: attachment.mimetype,
            size: attachment.size,
            url: `${baseUrl}/jobs/${this.id}/download/attachments/${filename}`
        });
        this.manifest = await this.getAugmentedManifest()
        await unlink(src)
        await release()
        await this.save()
    }

    protected async addDefaultAttachments(baseUrl: string) {
        const release = await lock(this.path)
        const dst = Path.join(this.path, "attachments")
        await mkdir(dst, { recursive: true })
        const dir = Path.join(__dirname, "..", "default_attachments")
        const files = await readdir(dir, { withFileTypes: true })
        for (const file of files) {
            const path = getPrefixedFilePath(dst, file.name)
            const filename = Path.basename(path)
            await copyFile(Path.join(dir, file.name), path);
            const info = await stat(path)
            this.attachments.push({
                title: filename,
                contentType: mime.getType(path) || undefined,
                size: info.size,
                url: `${baseUrl}/jobs/${this.id}/download/attachments/${filename}`
            });
        }
        this.manifest = await this.getAugmentedManifest()
        await release()
        await this.save()
    }

    public async removeAttachment(fileName: string, baseUrl: string) {
        if (this.status !== "retrieved") {
            throw new HttpError(`Cannot remove attachments from export in "${this.status}" state`).status(400)
        }
        const dst = Path.join(this.path, "attachments", fileName)
        const url = `${baseUrl}/jobs/${this.id}/download/attachments/${fileName}`
        if (this.attachments.find(x => x.url === url) && statSync(dst, { throwIfNoEntry: false })?.isFile()) {
            const release = await lock(this.path)
            await unlink(dst)
            this.attachments = this.attachments.filter(x => x.url !== url)
            this.manifest = await this.getAugmentedManifest()
            await release()
            await this.save()
        }
    }

    protected async getAugmentedManifest(): Promise<EHI.ExportManifest | null> {

        if (!this.attachments.length) {
            return this.manifest
        }

        const baseUrl = this.attachments[0].url!.replace(/\/jobs\/.*/, "")

        const result = {
            ...this.manifest,
            output: [...this.manifest!.output]
        }

        const url = `${baseUrl}/jobs/${this.id}/download/attachments.DocumentReference.ndjson`

        result.output = result.output.filter(x => x.url !== url)

        result.output.push({ type: "DocumentReference", url, count: this.attachments.length })

        await writeFile(
            Path.join(this.path, "attachments.DocumentReference.ndjson"),
            JSON.stringify({
                resourceType: "DocumentReference",
                status: "current",
                subject: { reference: "Patient/" + this.patient.id },
                content: this.attachments.map(x => ({ attachment: x })),
                meta: {
                    tag: [{
                        code: "ehi-export",
                        display: "generated as part of an ehi-export request"
                    }]
                }
            }),
            "utf8"
        )

        return result as EHI.ExportManifest
    }

    public async approve() {
        this.status = "approved"
        return this.save()
    }

    public async reject() {
        this.status = "rejected"
        return this.destroy()
    }

}

