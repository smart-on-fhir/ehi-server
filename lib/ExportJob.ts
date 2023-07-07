import Path                                            from "path"
import {existsSync, rmSync }                           from "fs"
import { appendFile, mkdir, readFile, writeFile }      from "fs/promises"
import crypto                                          from "crypto"
import { Request }                                     from "express"
import patients                                        from "../data/db"
import config                                          from "../config"
import { HttpError }                                   from "./errors"
import { getPath, getRequestBaseURL, humanName, wait } from "."
import { EHI } from "../index"


export default class ExportJob
{
    /**
     * Each export job has an unique hex string ID
     */
    readonly id: string;

    /**
     * The patient who's data is being exported (only ID and humanized name)
     */
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
     * @param patientId The ID of the exported patient
     */
    public static async create(patientId: string)
    {
        return new ExportJob(patientId).save()
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
            const path = Path.join(config.jobsDir, id, "job.json")
            const json = JSON.parse(await readFile(path, "utf8"))
            const job = new ExportJob(json.patient.id, json.id)
            Object.assign(job, json)
            return job
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
    }

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
            error: [] as any[],
            extension: {
                metadata: `${baseUrl}/jobs/${this.id}/metadata`
            }
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
            authorizations: this.authorizations
        }
    }

    public async customizeAndStart(req: Request)
    {
        if (this.status !== "awaiting-input") {
            throw new HttpError('Exports job already started').status(400)
        }
        this.parameters     = req.body.parameters
        this.authorizations = req.body.authorizations
        this.status = "requested"
        await this.save()
        this.kickOff(req); // DON'T WAIT FOR THIS!
        return this
    }
}

