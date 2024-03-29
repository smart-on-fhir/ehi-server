import Path                                          from "path"
import { statSync }                                  from "fs"
import { Request, Response }                         from "express"
import { readdir }                                   from "fs/promises"
import config                                        from "../config"
import { ExportJob }                                 from "./ExportJob"
import { HttpError }                                 from "./errors"
import { createOperationOutcome, getRequestBaseURL } from "./utils"


/**
 * @route ```http
 * POST /jobs/:id
 * ```
 */
export async function customizeAndStart(req: Request, res: Response) {
    const job = await ExportJob.byId(req.params.id)
    await job.customize(req.body.parameters, req.body.authorizations)
    job.kickOff(getRequestBaseURL(req)) // DON'T WAIT
    res.json(job)
}

/**
 * @route ```http
 * GET /jobs/:id/download/:file
 * ```
 */
export async function downloadFile(req: Request, res: Response) {
    const dir = Path.join(config.jobsDir, req.params.id)

    if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
        return res.status(404).json(createOperationOutcome("Export job not found"))
    }

    const path = Path.join(dir, req.params.file)

    if (!statSync(path, { throwIfNoEntry: false })?.isFile()) {
        return res.status(404).json(createOperationOutcome("File not found"))
    }

    res.sendFile(path, {
        headers: {
            "content-type": "application/fhir+ndjson",
            "content-disposition": "attachment",
            "connection": "close"
        }
    })
}

/**
 * @route ```http
 * GET /jobs/:id/download/attachments/:file
 * ```
 */
export async function downloadAttachment(req: Request, res: Response) {
    const job = await ExportJob.byId(req.params.id)
    const filePath = Path.join(job.path, "attachments", req.params.file)
    if (!statSync(filePath, { throwIfNoEntry: false })?.isFile()) {
        throw new HttpError(`This job has no attachment "${req.params.file}"`).status(404)
    }
    res.sendFile(filePath)
}

/**
 * @route ```http
 * DELETE /jobs/:id/status
 * ```
 */
export async function abort(req: Request, res: Response) {
    const job = await ExportJob.byId(req.params.id)
    await job.destroy()
    res.status(202).json(createOperationOutcome("Export deleted", { severity: "information" }))
}

/**
 * @route ```http
 * GET /jobs/:id/status
 * ```
 */
export async function checkStatus(req: Request, res: Response) {
    try {
        var job = await ExportJob.byId(req.params.id)
    } catch (ex) {
        return res.status(404).json(createOperationOutcome((ex as Error).message))
    }

    if (job.status === "approved" && job.manifest) {
        return res.json(job.manifest)
    }

    // If the EHI Server provided a patient interaction link in the Kick-off
    // response and the patient has not completed the form at that link, the EHI
    // Server SHALL return the same Link header as part of the status response
    // (along with optional Retry-After and X-Progress headers as described in
    // the Async Pattern)
    if (job.status === "awaiting-input") {
        const baseUrl = getRequestBaseURL(req);
        res.header("Link", `${baseUrl}/jobs/${job.id}/customize?_patient=${job.patient.id}; rel="patient-interaction"`)
    }

    res.header("X-Progress" , job.status)
    res.header("Retry-after", config.jobCleanupMinutes * 60 + "")
    res.status(202).end()
}

/**
 * @route ```http
 * POST /fhir/Patient/:id/$ehi-export
 * POST /auto-approve/fhir/Patient/:id/$ehi-export
 * POST /no-form/fhir/Patient/:id/$ehi-export
 * POST /no-form/auto-approve/fhir/Patient/:id/$ehi-export
 * POST /auto-approve/no-form/fhir/Patient/:id/$ehi-export
 * ```
 */
export async function kickOff(req: Request, res: Response) {
    const baseUrl = getRequestBaseURL(req);
    const job = await ExportJob.create(req.params.id)
    if (req.url.includes("/auto-approve/")) {
        job.autoApprove = true
        await job.save()
    }
    if (!req.url.includes("/no-form/")) {
        res.header("Link", `${baseUrl}/jobs/${job.id}/customize?_patient=${req.params.id}; rel="patient-interaction"`)
    } else {
        job.kickOff(baseUrl, true)
    }
    res.header("Content-Location", `${baseUrl}/jobs/${job.id}/status`)
    res.header("Access-Control-Expose-Headers", "Content-Location, Link")
    res.status(202).json({ message: "Please follow the url in the link header to customize your export" })
}

/**
 * @route ```http
 * GET /jobs/:id/customize
 * ```
 */
export async function renderForm(req: Request, res: Response) {
    
    const job = await ExportJob.byId(req.params.id)
    
    let patient = req.query._patient
    if (Array.isArray(patient)) {
        patient = patient.pop()
    }

    // This is totally fake and only used for demo purposes! If _patient
    // param is not provided show the patient picker to login. In reality we
    // don't need this because the job already knows who the patient is.
    if (!req.query._patient) {
        const q = new URLSearchParams()
        q.set("action", getRequestBaseURL(req) + req.url)
        q.set("_patient", job.patient.id)

        // WHERE SHOULD THIS COME FROM???
        q.set("redirect", String(req.query.redirect || "") || "http://127.0.0.1:3000/")

        return res.redirect(`/patient-login?${q}`)
    }

    res.render("form", {
        jobId   : req.params.id,
        patient,
        redirect: req.query.redirect,
        token   : req.query.token,
        job
    })
}

/**
 * @route ```http
 * GET /admin/jobs
 * ```
 */
export async function listJobs(req: Request, res: Response) {
    const result = []
    for (const id of await readdir(config.jobsDir)) {
        if (statSync(Path.join(config.jobsDir, id)).isDirectory()) {
            result.push((await ExportJob.byId(id)).toJSON())
        }
    }
    res.json(result)
}

/**
 * @route ```http
 * GET /admin/jobs/:id
 * ```
 */
export async function getJob(req: Request, res: Response) {
    const job = await ExportJob.byId(req.params.id)
    res.json(job)
}

/**
 * @route ```http
 * POST /admin/jobs/:id/approve
 * ```
 */
export async function approveJob(req: Request, res: Response) {
    const job = await ExportJob.byId(req.params.id)
    res.json(await job.approve())
}

/**
 * @route ```http
 * POST /admin/jobs/:id/reject
 * ```
 */
export async function rejectJob(req: Request, res: Response) {
    const job = await ExportJob.byId(req.params.id)
    res.json(await job.reject())
}

/**
 * @route ```http
 * POST /admin/jobs/:id/add-files
 * ```
 */
export async function addFiles(req: Request, res: Response) {
    const job = await ExportJob.byId(req.params.id)
    const files = ((req.files || []) as Express.Multer.File[]).filter(f => f.fieldname === "attachments")
    if (!files.length) {
        throw new HttpError('Called "addFiles" without uploaded "attachments"').status(400)
    }
    const baseUrl = getRequestBaseURL(req)
    for (const file of files) {
        await job.addAttachment(file, baseUrl)
    }
    res.json(job)
}

/**
 * @route ```http
 * POST /admin/jobs/:id/remove-files
 * ```
 */
export async function removeFiles(req: Request, res: Response) {
    const job = await ExportJob.byId(req.params.id)
    const files = req.body.params || []
    const baseUrl = getRequestBaseURL(req)
    for (const file of files) {
        await job.removeAttachment(file, baseUrl)
    }
    res.json(job)
}

/**
 * @route ```http
 * DELETE /admin/jobs/:id
 * ```
 */
export async function destroyJob(req: Request, res: Response) {
    const job = await ExportJob.byId(req.params.id)
    res.json(await job.destroy())
}
