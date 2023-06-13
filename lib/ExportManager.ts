import Path               from "path"
import crypto             from "crypto"
import { Request }        from "express"
import patients           from "../data/db"
import config             from "../config"
import { HttpError }      from "./errors"
import {
    existsSync,
    readdirSync,
    statSync,
    rmSync
} from "fs"
import {
    appendFile,
    copyFile,
    mkdir,
    readFile,
    unlink,
    writeFile
} from "fs/promises"
import {
    getPath,
    getPrefixedFilePath,
    getRequestBaseURL,
    humanName,
    wait
} from "."


interface ExportManifest {
    transactionTime: string
    requiresAccessToken: boolean
    output: any[]
    error: any[]
}


/**
 * Ideally, we'd have a reference implementation of the "Provider side" that
 * shows a bit of the back-office workflow around handling requests including.
 * We've talked with several administrators responsible for "health information
 * management" departments of hospitals, and a common theme is that they rely on
 * internal workflows for preparing and reviewing the material for exports.
 * Without getting too complex in terms of project scope, I was thinking that a
 * couple of really useful features on the provider side to reflect real world
 * conditions would be:  
 * 
 * 1. Ability to configure an online form that patients fill out in the process
 * of initiating an export (example: sections C and D of this form, but of
 * course there would be no reason for us to use PDFs)
 * 2. UX for provider staff to track and manage the "Export Tasks" and
 *  - Add results to a task (e.g., dragging a CSV file into the browser to
 *    simulate the manual gathering of data from different underlying systems)
 *  - Mark an export as "Ready for release" (i.e., triggering its availability
 *    to the patient)
 */
export default class ExportJob
{
    readonly id: string;

    patientId: string;

    patient: {
        id: string
        name: string
    };

    manifest: ExportManifest | null = null;

    status: EHI.ExportJobStatus = "awaiting-input";

    readonly path: string;

    protected createdAt: number = 0;

    protected completedAt: number = 0;

    protected attachments: fhir4.Attachment[] = [];
    
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
     * @param patientId The ID of the exported patient
     */
    public static async create(patientId: string)
    {
        const job = new ExportJob(patientId)
        await job.save()
        return job
    }

    public async destroy()
    {
        const path = Path.join(config.jobsDir, this.id)
        try {
            rmSync(path, { force: true, recursive: true })
        } catch (ex) {
            console.error(ex)
            throw new Error("Unable to abort job with id '${id}'.")
        }
    }

    /**
     * Delete a job by ID if:
     * - The job has been aborted
     * - The job has been completed more than `completedJobLifetimeMinutes` minutes ago
     * - The job started more than `jobMaxLifetimeMinutes` minutes ago and is still pending
     * Note that jobs having "in-review" status will NOT be deleted
     */
    public static async destroyIfNeeded(id: string)
    {
        const job = await ExportJob.byId(id)
        switch (job.status) {
            case "aborted":
            case "rejected":
                await job.destroy()
            break;
            case "retrieved":
                if (Date.now() - job.completedAt > config.completedJobLifetimeMinutes * 60000) {
                    await job.destroy()
                }
            break;
            case "in-review":
            case "awaiting-input":
                if (Date.now() - job.createdAt > config.jobMaxLifetimeMinutes * 60000) {
                    await job.destroy()
                }
            break;
        }
    }

    public static async byId(id: string)
    {
        try {
            const instance = new ExportJob("tmp", id)
            await instance.load()
            return instance
        } catch {
            throw new HttpError("Export job not found! Perhaps it has already completed.").status(404)
        }
    }

    /**
     * NOTE: The constructor is protected because it is not supposed to be
     * called directly from outside this class. The reason is that one would
     * also want to save the new instance to a file and that is async task but
     * constructors cannot be async. `ExportManager.create()` can be used instead
     * @param patientId The ID of the exported patient
     */
    protected constructor(patientId: string, _jobId?: string) {
        this.id = _jobId || crypto.randomBytes(8).toString("hex")
        this.createdAt = Date.now()
        const pt = patients.get(patientId)?.patient
        this.patientId = patientId
        this.patient = {
            id: patientId,
            name: pt ? humanName(pt) : "Unknown Patient Name"
        }
        this.path = Path.join(config.jobsDir, this.id)
    }

    /**
     * Add results to a task (e.g., dragging a CSV file into the browser to
     * simulate the manual gathering of data from different underlying systems)
     */
    // public async addAttachment(attachment: Express.Multer.File, baseUrl: string) {
    //     const src = Path.join(__dirname, "..", attachment.path)
    //     const dst = Path.join(this.path, "attachments")
    //     const path = getPrefixedFilePath(dst, attachment.originalname)
    //     const filename = basename(path)
    //     await mkdir(dst, { recursive: true });
    //     await copyFile(src, path);
    //     this.attachments.push({
    //         title: filename,
    //         contentType: attachment.mimetype,
    //         size: attachment.size,
    //         url: `${baseUrl}/jobs/${this.id}/download/attachments/${filename}`
    //     });
    //     await this.save()
    //     await unlink(src)
    // }

    // public async addAttachments(req: Request) {
    //     const files = (req.files as any[] || []).filter(f => f.fieldname === "attachments")
    //     if (files.length) {
    //         const baseUrl = getRequestBaseURL(req)
    //         for (const file of files) {
    //             await this.addAttachment(file, baseUrl)
    //         }
    //     }
    // }

    // public async removeAttachment(fileName: string) {
    //     if (this.status !== "awaiting-input" && this.status !== "in-review") {
    //         throw new HttpError(`Cannot remove attachments from export in "${this.status}" state`).status(400)
    //     }
        
    //     this.attachments = this.attachments.filter(x => !x.url!.endsWith(`/${this.id}/download/attachments/${fileName}`))
    //     await this.save()
    // }

    // public async removeAttachments(fileNames: string[]) {
    //     for (const fileName of fileNames) {
    //         await this.removeAttachment(fileName)
    //     }
    // }

    public async abort()
    {
        this.status = "aborted"
        return await this.save()
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

    public async kickOff(req: Request)
    {
        const baseUrl       = getRequestBaseURL(req)
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
                        url  : `${baseUrl}/jobs/${this.id}/download/${resourceType}`,
                        count: 1
                    })
                } else {
                    fileEntry.count += 1;
                }
            }
        };

        // Try adding every resource from the transaction bundle
        for (const entry of patientBundle.entry!) {
            await addOutputEntry(entry.resource!)
            await wait(config.jobThrottle)
        }

        if (this.attachments.length) {
            await addOutputEntry<fhir4.DocumentReference>({
                resourceType: "DocumentReference",
                status: "current",
                subject: { reference: "Patient/" + this.patient.id },
                content: this.attachments.map(f => ({ attachment: f })),
                meta: {
                    tag: [{
                        code: "ehi-export",
                        display: "generated as part of an ehi-export request"
                    }
                ]}
            }, true)
        }

        this.completedAt = Date.now()
        this.manifest = manifest
        this.status = "retrieved"
        await this.save()
    }

    async save()
    {
        if (!existsSync(this.path)) {
            await mkdir(this.path)
        }
        
        await writeFile(
            Path.join(this.path, `job.json`),
            JSON.stringify(this, null, 4),
            "utf8"
        );
        return this;
    }

    protected async load()
    {
        const path = Path.join(this.path, "job.json")
        const json = JSON.parse(await readFile(path, "utf8"));
        Object.assign(this, json)
        return this;
    }

    public toJSON(): EHI.ExportJob
    {
        return {
            id            : this.id,
            patientId     : this.patient.id,
            patient       : this.patient,
            manifest      : this.manifest,
            status        : this.status,
            createdAt     : this.createdAt,
            completedAt   : this.completedAt,
            attachments   : this.attachments,
            parameters    : this.parameters,
            authorizations: this.authorizations
        }
    }

    public setParameters(parameters: EHI.ExportJobInformationParameters) {
        this.parameters = parameters
        return this
    }

    public setAuthorizations(authorizations: EHI.ExportJobAuthorizations) {
        this.authorizations = authorizations
        return this
    }
}

export async function check(dir = "jobs")
{
    const base  = Path.join(__dirname, "..", dir)
    const items = readdirSync(base);
    for (const id of items) {
        if (statSync(Path.join(base, id)).isDirectory()) {
            await ExportJob.destroyIfNeeded(id)
        }
    }
    setTimeout(check.bind(null, dir), config.jobCleanupMinutes * 60000).unref()
}

check();
