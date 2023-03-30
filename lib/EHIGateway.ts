import Path                                          from "path"
import { readdirSync, statSync }                     from "fs"
import { readFile }                                  from "fs/promises"
import { Request, Response }                         from "express"
import config                                        from "../config"
import ExportJob                                     from "./ExportManager"
import { createOperationOutcome, getRequestBaseURL } from "."


export async function viewJob(req: Request, res: Response) {
    try {
        res.json(await ExportJob.byId(req.params.id))
    } catch (ex) {
        return res.status(404).json(createOperationOutcome((ex as Error).message))
    }
}

export async function updateJob(req: Request, res: Response) {

    // The following actions should be supported:
    // - Add attachments
    // - Remove attachments
    // - Approve
    // - Reject

    res.end("Not implemented")
}

export async function listJobs(req: Request, res: Response) {
    const output = {
        errors: [],
        meta: {},
        data: { jobs: [] as any[] }
    };
    const base = Path.join(__dirname, "../jobs")
    const items = readdirSync(base);
    for (const id of items) {
        if (statSync(Path.join(base, id)).isDirectory()) {
            const json = JSON.parse(
                await readFile(
                    Path.join(base, id, "job.json"),
                    "utf8"
                )
            );
            output.data.jobs.push(json)
        }
    }
    res.json(output)
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
        res.header("Link", `${baseUrl}${req.originalUrl}/customize?token=${req.headers.authorization?.replace(/^\s*bearer\s+/i, "")}; rel="patient-interaction"`)
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
    res.render("form", {
        patient: req.params.id,
        token  : req.query.token
    })
}
