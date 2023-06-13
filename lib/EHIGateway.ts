import Path                                          from "path"
import { readdirSync, statSync }                     from "fs"
import { readFile }                                  from "fs/promises"
import { Request, Response }                         from "express"
import archiver                                      from "archiver"
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
    

    try {
        var job = await ExportJob.byId(req.params.id)
    } catch (ex) {
        return res.status(404).json(createOperationOutcome((ex as Error).message))
    }

    const { action = "", params = [] } = req.body
    
    switch (action) {
        case "addAttachments":
            const files = (req.files as any[] || []).filter(f => f.fieldname === "attachments")
            if (!files.length) {
                throw new HttpError('The "addAttachments" action requires that one more files are upload via the "attachments" field').status(400)
            }
            await job.addAttachments(req)
            return res.json(job)

        // case "removeAttachments":
        //     await job.removeAttachments(params)
        //     return res.json(job)

        case "approve":
            if (job.status !== "in-review") {
                throw new HttpError('Only "in-review" exports can be approved').status(400)
            }
            job.status = "requested"
            await job.save()
            job.kickOff(req); // DON'T WAIT FOR THIS!
            return res.json(job);

        // case "reject":
        //     if (job.status !== "in-review" && job.status !== "awaiting-input") {
        //         throw new HttpError('Only "in-review" and "awaiting-input" exports can be rejected').status(400)
        //     }
        //     job.status = "rejected"
        //     await job.save()
        //     return res.json(job);

        case "customize":
            if (job.status !== "in-review" && job.status !== "awaiting-input") {
                throw new HttpError('Only "in-review" and "awaiting-input" exports can be customized').status(400)
            }
            job.setParameters(req.body.payload.parameters)
            job.setAuthorizations(req.body.payload.authorizations)
            job.status = "in-review"
            await job.save()
            return res.json(job)

        case "":
            throw new HttpError("Missing action parameter in the POST body").status(400)

        default:
            throw new HttpError(`Invalid action parameter "${action}" in the POST body`).status(400)
    }
}

// export async function listJobs(req: Request, res: Response) {
//     // const { sort = "date:desc" } = req.query;
//     // const [ sortBy, sortDir ] = String(sort || "").trim().split(":");
//     const jobs: Omit<EHI.ExportJob, "manifest" | "parameters" | "authorizations">[] = [];
//     const base = config.jobsDir;
//     const items = readdirSync(base);
//     for (const id of items) {
//         if (statSync(Path.join(base, id)).isDirectory()) {
//             const json = JSON.parse(
//                 await readFile(
//                     Path.join(base, id, "job.json"),
//                     "utf8"
//                 )
//             );
//             delete json.manifest
//             delete json.parameters
//             delete json.authorizations
//             jobs.push(json)
//         }
//     }

//     jobs.sort((a, b) => a.completedAt - b.createdAt)

//     res.json(jobs)
// }

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

// export async function downloadAttachment(req: Request, res: Response) {
//     const dir = Path.join(config.jobsDir, req.params.id)

//     if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
//         return res.status(404).json(createOperationOutcome("Export job not found"))
//     }

//     const path = Path.join(dir, "attachments", req.params.file)

//     if (!statSync(path, { throwIfNoEntry: false })?.isFile()) {
//         return res.status(404).json(createOperationOutcome("File not found"))
//     }

//     res.sendFile(path, {
//         headers: {
//             "connection": "close",
//             "content-disposition": "attachment"
//         }
//     })
// }

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
    res.status(202)
    return res.end()
}

export async function kickOff(req: Request, res: Response) {
    const baseUrl = getRequestBaseURL(req);
    const job = await ExportJob.create(req.params.id)
    res.header("Content-Location", `${baseUrl}/jobs/${job.id}/status`)
    res.header("Access-Control-Expose-Headers", "Content-Location, Link")
    res.header("Link", `${baseUrl}/jobs/${job.id}/customize?behavior=automatic&_patient=${req.params.id}; rel="patient-interaction"`)
    res.status(202)
    res.json({ message: "Please follow the url in the link header to customize your export" })
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
        // q.set("redirect", "http://localhost:3000/")
        q.set("redirect", String(req.query.redirect || "") || "http://localhost:3000/")

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

// export async function downloadArchive(req: Request, res: Response) {
//     const job = await ExportJob.byId(req.params.id)
//     const archive = archiver('zip', { zlib: { level: 9 }});

//     const date = new Date(job.manifest!.transactionTime)
//     const filename = `EHI Export ${date.toDateString()}.zip`

//     res.setHeader('Content-Type', 'application/zip');
//     res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
//     archive.pipe(res);

//     const items = readdirSync(job.path);
//     for (const name of items) {
//         const path = Path.join(job.path, name)
//         if (name.endsWith(".ndjson") && statSync(path).isFile()) {
//             archive.file(path, { name });
//         }
//         archive.directory(Path.join(job.path, "attachments"), "attachments");
//         archive.append(JSON.stringify(job.manifest, null, 4), { name: "manifest.json" });
//     }

//     archive.finalize();
// }
