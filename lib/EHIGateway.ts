import Path                                          from "path"
import { statSync }                                  from "fs"
import { Request, Response }                         from "express"
import { readdir }                                   from "fs/promises"
import config                                        from "../config"
import ExportJob                                     from "./ExportJob"
import { HttpError }                                 from "./errors"
import { createOperationOutcome, getRequestBaseURL } from "."


export async function customizeAndStart(req: Request, res: Response) {
    const job = await ExportJob.byId(req.params.id)
    await job.customize(req.body.parameters, req.body.authorizations)
    job.kickOff(getRequestBaseURL(req)) // DON'T WAIT
    res.json(job)
}

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

export async function downloadAttachment(req: Request, res: Response) {
    const job = await ExportJob.byId(req.params.id)
    const filePath = Path.join(job.path, "attachments", req.params.file)
    if (!statSync(filePath, { throwIfNoEntry: false })?.isFile()) {
        throw new HttpError(`This job has no attachment "${req.params.file}"`).status(404)
    }
    res.sendFile(filePath)
}

export async function abort(req: Request, res: Response) {
    const job = await ExportJob.byId(req.params.id)
    await job.abort()
    await job.destroy()
    res.status(202).json(createOperationOutcome("Export aborted and deleted", { severity: "information" }))
}

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
        job.kickOff(baseUrl)
    }
    res.header("Content-Location", `${baseUrl}/jobs/${job.id}/status`)
    res.header("Access-Control-Expose-Headers", "Content-Location, Link")
    res.status(202).json({ message: "Please follow the url in the link header to customize your export" })
}

export async function renderForm(req: Request, res: Response) {
    
    const job = await ExportJob.byId(req.params.id)

    // FIXME: This is totally fake and only used for demo purposes! If _patient
    // param is not provided show the patient picker to login. In reality we
    // don't need this because the job already knows who the patient is.
    if (!req.query._patient) {
        const q = new URLSearchParams()
        q.set("action", getRequestBaseURL(req) + req.url)
        q.set("_patient", job.patient.id)

        // TODO: WHERE SHOULD THIS COME FROM???
        // q.set("redirect", "http://127.0.0.1:3000/")
        // q.set("redirect", "http://localhost:3000/")
        q.set("redirect", String(req.query.redirect || "") || "http://127.0.0.1:3000/")

        return res.redirect(`/patient-login?${q}`)
    }

    res.render("form", {
        jobId   : req.params.id,
        patient : req.query._patient,
        redirect: req.query.redirect,
        token   : req.query.token,
        job
    })
}

export async function listJobs(req: Request, res: Response) {
    const result = []
    for (const id of await readdir(config.jobsDir)) {
        if (statSync(Path.join(config.jobsDir, id)).isDirectory()) {
            result.push((await ExportJob.byId(id)).toJSON())
        }
    }
    res.json(result)
}

export async function getJob(req: Request, res: Response) {
    const job = await ExportJob.byId(req.params.id)
    res.json(job)
}

export async function approveJob(req: Request, res: Response) {
    const job = await ExportJob.byId(req.params.id)
    res.json(await job.approve())
}

export async function rejectJob(req: Request, res: Response) {
    const job = await ExportJob.byId(req.params.id)
    res.json(await job.reject())
}

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

export async function removeFiles(req: Request, res: Response) {
    const job = await ExportJob.byId(req.params.id)
    const files = req.body.params || []
    const baseUrl = getRequestBaseURL(req)
    for (const file of files) {
        await job.removeAttachment(file, baseUrl)
    }
    res.json(job)
}
