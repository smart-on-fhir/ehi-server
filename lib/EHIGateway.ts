import Path                                          from "path"
import { statSync }                                  from "fs"
import { Request, Response }                         from "express"
import config                                        from "../config"
import ExportJob                                     from "./ExportJob"
import { createOperationOutcome, getRequestBaseURL } from "."


export async function customizeAndStart(req: Request, res: Response) {
    const job = await ExportJob.byId(req.params.id)
    await job.customizeAndStart(req)
    return res.json(job)
}

export async function getJobMetadata(req: Request, res: Response) {
    const job = await ExportJob.byId(req.params.id)
    res.json(job)
}

export async function downloadFile(req: Request, res: Response) {
    const dir = Path.join(config.jobsDir, req.params.id)

    if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
        return res.status(404).json(createOperationOutcome("Export job not found"))
    }

    const path = Path.join(dir, req.params.resourceType + ".ndjson")

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

    if (job.status === "retrieved") {
        return res.json(job.manifest)
    }

    res.header("X-Progress" , job.status)
    res.header("Retry-after", config.jobCleanupMinutes * 60 + "")
    res.status(202).end()
}

export async function kickOff(req: Request, res: Response) {
    const baseUrl = getRequestBaseURL(req);
    const job = await ExportJob.create(req.params.id)
    res.header("Content-Location", `${baseUrl}/jobs/${job.id}/status`)
    res.header("Access-Control-Expose-Headers", "Content-Location, Link")
    res.header("Link", `${baseUrl}/jobs/${job.id}/customize?_patient=${req.params.id}; rel="patient-interaction"`)
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

export async function getJob(req: Request, res: Response) {
    const job = await ExportJob.byId(req.params.id)
    res.json(job)
}

export async function approveJob(req: Request, res: Response) {
    const job = await ExportJob.byId(req.params.id)
    job.status = "approved"
    await job.save()
    res.json(job)
}

export async function rejectJob(req: Request, res: Response) {
    const job = await ExportJob.byId(req.params.id)
    job.status = "rejected"
    await job.save()
    res.json(job)
}

