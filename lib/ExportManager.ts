import Path                                          from "path"
import { existsSync, readdirSync, statSync, rmSync } from "fs"
import crypto                                        from "crypto"
import { Request }                                   from "express"
import { appendFile, copyFile, mkdir, readFile, unlink, writeFile } from "fs/promises"
import patients                                      from "../data/db"
import config                                        from "../config"
import { HttpError }                                 from "./errors"
import { getRequestBaseURL, wait }                   from "."


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

    manifest: ExportManifest | null = null;

    status: EHI.ExportJobStatus = "awaiting-input";

    protected createdAt: number = 0;

    protected completedAt: number = 0;

    protected attachments: fhir4.Attachment[] = [];
    
    protected parameters: EHI.ExportJobInformationParameters = {};

    protected authorizations: EHI.ExportJobAuthorizations = {};


    /**
     * @param patientId The ID of the exported patient
     */
    public static async create(patientId: string)
    {
        const job = new ExportJob(patientId)
        await job.save()
        return job
    }

    public static async destroy(id: string)
    {
        if (!existsSync(Path.join(__dirname, "../jobs", id))) {
            throw new Error("Export job not found! Perhaps it has already completed.")
        }
        try {
            rmSync(Path.join(__dirname, "../jobs/", id), { force: true, recursive: true })
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
        const now = Date.now()

        let shouldDelete = false

        if (job.status === "aborted" || job.status === "rejected") {
            shouldDelete = true
        }
        else if (job.status === "retrieved") {
            shouldDelete = now - job.completedAt > config.completedJobLifetimeMinutes * 60000
        }
        else if (job.status === "in-review" || job.status === "awaiting-input") {
            shouldDelete = now - job.createdAt > config.jobMaxLifetimeMinutes * 60000
        }

        if (shouldDelete) {
            await ExportJob.destroy(id)
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
    protected constructor(patientId: string, _id?: string) {
        this.id = _id || crypto.randomBytes(8).toString("hex")
        this.createdAt = Date.now()
        this.patientId = patientId
    }

    /**
     * Add results to a task (e.g., dragging a CSV file into the browser to
     * simulate the manual gathering of data from different underlying systems)
     */
    public async addAttachment(attachment: Express.Multer.File, baseUrl: string) {
        const src = Path.join(__dirname, "..", attachment.path)
        const dst = Path.join(__dirname, `../jobs/${this.id}/attachments`)
        await mkdir(dst, { recursive: true });
        await copyFile(src, Path.join(dst, attachment.filename));
        this.attachments.push({
            contentType: attachment.mimetype,
            size: attachment.size,
            url: `${baseUrl}/jobs/${this.id}/download/attachments/${attachment.filename}`
        });
        await this.save()
        await unlink(src)
    }

    public async addAttachments(req: Request) {
        const files = (req.files as any[] || []).filter(f => f.fieldname === "attachments")
        if (files.length) {
            const baseUrl = getRequestBaseURL(req)
            for (const file of files) {
                await this.addAttachment(file, baseUrl)
            }
        }
    }

    public async removeAttachment(fileName: string) {
        if (this.status !== "awaiting-input" && this.status !== "in-review") {
            throw new HttpError(`Cannot remove attachments from export in "${this.status}" state`).status(400)
        }
        
        this.attachments = this.attachments.filter(x => x.url!.endsWith(`/${this.id}/download/attachments/${fileName}`))
        await this.save()
    }

    public async removeAttachments(fileNames: string[]) {
        for (const fileName of fileNames) {
            await this.removeAttachment(fileName)
        }
    }

    public async abort()
    {
        this.status = "aborted"
        return await this.save()
    }

    public async kickOff(req: Request)
    {
        const path    = patients.get(this.patientId)!.file
        const data    = await readFile(path, "utf8")
        const json    = JSON.parse(data) as fhir4.Bundle
        const baseUrl = getRequestBaseURL(req);

        const manifest = {
            transactionTime: new Date(this.createdAt).toISOString(),
            requiresAccessToken: true,
            output: [] as any[],
            error: [] as any[]
        };

        const addOutputEntry = async <T extends fhir4.Resource>(resource: T) => {
            const { resourceType } = resource
            const destination = Path.join(__dirname, "../jobs", this.id, resourceType + ".ndjson")
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
        };

        for (const entry of json.entry!) {
            await addOutputEntry(entry.resource!)
            await wait(config.jobThrottle)
        }

        if (this.attachments.length) {
            await addOutputEntry<fhir4.DocumentReference>({
                resourceType: "DocumentReference",
                status: "current",
                subject: { reference: "Patient/" + this.patientId },
                content: this.attachments.map(f => ({ attachment: f }))
            })
        }

        this.completedAt = Date.now()
        this.manifest = manifest
        this.status = "retrieved"
        await this.save()
    }

    async save()
    {
        if (!existsSync(Path.join(__dirname, `../jobs/${this.id}`))) {
            await mkdir(Path.join(__dirname, `../jobs/${this.id}`))
        }
        
        await writeFile(
            Path.join(__dirname, `../jobs/${this.id}/job.json`),
            JSON.stringify(this, null, 4),
            "utf8"
        );
        return this;
    }

    protected async load()
    {
        const path = Path.join(__dirname, "../jobs", this.id, "job.json")
        const json = JSON.parse(await readFile(path, "utf8"));
        Object.assign(this, json)
        return this;
    }

    public toJSON(): EHI.ExportJob
    {
        return {
            id            : this.id,
            patientId     : this.patientId,
            manifest      : this.manifest,
            status        : this.status,
            createdAt     : this.createdAt,
            completedAt   : this.completedAt,
            attachments   : this.attachments,
            parameters    : this.parameters,
            authorizations: this.authorizations
        }
    }

    /**
     * Currently returns true only if the form was filled in by providing at
     * least one parameter and at least one authorization.
     */
    public needsPatientInteraction() {
        let hasParams = false;
        let hasAuth   = false;

        for (const name in this.parameters) {
            if (this.parameters[name as keyof typeof this.parameters]?.enabled) {
                hasParams = true;
                break;
            }
        }

        for (const name in this.authorizations) {
            if (this.authorizations[name as keyof typeof this.authorizations]?.value) {
                hasAuth = true;
                break;
            }
        }

        return hasParams && hasAuth
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

async function check()
{
    const base  = Path.join(__dirname, "../jobs")
    const items = readdirSync(base);
    for (const id of items) {
        if (statSync(Path.join(base, id)).isDirectory()) {
            await ExportJob.destroyIfNeeded(id)
        }
    }
    setTimeout(check, config.jobCleanupMinutes * 60000).unref()
}

check();
