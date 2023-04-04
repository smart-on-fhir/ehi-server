import Path                                          from "path"
import { readdirSync, statSync }                     from "fs"
import { readFile }                                  from "fs/promises"
import { Request, Response }                         from "express"
import config                                        from "../config"
import ExportJob                                     from "./ExportManager"
import { HttpError }                                 from "./errors"
import { createOperationOutcome, getRequestBaseURL } from "."


export async function viewJob(req: Request, res: Response) {
    try {
        res.json(await ExportJob.byId(req.params.id))
    } catch (ex) {
        return res.status(404).json(createOperationOutcome((ex as Error).message))
    }
}

/**
 * RPC-like interface for updating a job
 * @param req 
 * @param res 
 */
export async function updateJob(req: Request, res: Response) {

    const { action = "", params = [] } = req.body
    
    switch (action) {
        case "addAttachments":
            res.end(`Action "${action}" not implemented yet`)
        break;
        case "removeAttachments":
            res.end(`Action "${action}" not implemented yet`)
        break;
        case "approve":
            res.end(`Action "${action}" not implemented yet`)
        break;
        case "reject":
            res.end(`Action "${action}" not implemented yet`)
        break;
        case "customize":
            res.end(`Action "${action}" not implemented yet`)
        break;
        case "":
            throw new HttpError("Missing action parameter in the POST body").status(400)
        default:
            throw new HttpError(`Invalid action parameter "${action}" in the POST body`).status(400)
    }
}

export async function listJobs(req: Request, res: Response) {
    const jobs: Omit<EHI.ExportJob, "manifest">[] = [];
    const base = Path.join(__dirname, "../jobs");
    const items = readdirSync(base);
    for (const id of items) {
        if (statSync(Path.join(base, id)).isDirectory()) {
            const json = JSON.parse(
                await readFile(
                    Path.join(base, id, "job.json"),
                    "utf8"
                )
            );
            delete json.manifest
            jobs.push(json)
        }
    }
    res.json(jobs)
}

export async function downloadFile(req: Request, res: Response) {
    const dir = Path.join(__dirname, "../jobs", req.params.id)

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
            "content-disposition": "attachment"
        }
    })
}

export async function abort(req: Request, res: Response) {
    try {
        var job = await ExportJob.byId(req.params.id)
    } catch (ex) {
        return res.status(404).json(createOperationOutcome((ex as Error).message))
    }

    await job.abort()
    await ExportJob.destroy(job.id)
    res.status(202).json(createOperationOutcome("Export aborted and deleted"))
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
    res.status(202)
    return res.end()
}

export async function kickOff(req: Request, res: Response) {
    const baseUrl = getRequestBaseURL(req);

    const job = await ExportJob.create(req.params.id)

    res.header("Content-Location", `${baseUrl}/jobs/${job.id}/status`)
    res.header("Access-Control-Expose-Headers", "Content-Location, Link")

    if (req.body?.resourceType !== "Parameters") {
        res.header("Link", `${baseUrl}/jobs/${job.id}/customize?token=${req.headers.authorization?.replace(/^\s*bearer\s+/i, "")}; rel="patient-interaction"`)
        res.status(202)
        res.json({ message: "Please follow the url in the link header to customize your export" })
    }
    else {
        job.kickOff(req)
        res.status(202)
        res.end()
    }
}

export async function renderForm(req: Request, res: Response) {
    
    // FIXME: This is totally fake and only used for demo purposes! If _patient
    // param is not provided show the patient picker to login. In reality we
    // don't need this because the job already knows who the patient is.
    if (!req.query._patient) {
        const job = await ExportJob.byId(req.params.id)
        const q = new URLSearchParams()
        q.set("action", getRequestBaseURL(req) + req.url)
        q.set("_patient", job.patientId)

        // TODO: WHERE SHOULD THIS COME FROM???
        q.set("redirect", "http://localhost:3000/")
        // q.set("redirect", req.query.redirect + "")

        return res.redirect(`/patient-login?${q}`)
    }

    res.render("form", {
        patient : req.params.id,
        redirect: req.query.redirect,
        token   : req.query.token
    })
}
