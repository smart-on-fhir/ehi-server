import Path                                  from "path"
import { afterEach }                         from "mocha"
import { expect }                            from "chai"
import { chmod, readFile, rm, writeFile }    from "fs/promises"
import { cleanupJobs, FIRST_PATIENT_ID, SERVER } from "../integration/TestContext"
import config                                from "../../config"
import ExportJob                             from "../../lib/ExportJob"
import { waitFor }                           from "../../lib"




describe("Jobs", () => {

    afterEach(cleanupJobs);
    
    it ("constructor requires patient id argument", () => {
        expect(() => new ExportJob()).to.throw();
    })

    it ("constructor accepts patient id argument", () => {
        const job: ExportJob = new ExportJob(FIRST_PATIENT_ID)
        expect(job.patient.id).to.equal(FIRST_PATIENT_ID);
        expect(job.patient.name).to.exist;
        expect(job.id).to.exist;
        expect(job.path).to.exist;
    })

    it ("save", async () => {
        const job: ExportJob = new ExportJob(FIRST_PATIENT_ID)
        await job.save()
        const path = Path.join(config.jobsDir, job.id, "job.json")
        const data = await readFile(path, "utf8")
        const json = JSON.parse(data)
        expect(json.id).to.equal(job.id)
        expect(json.patient.id).to.equal(job.patient.id)
        expect(json.patient.name).to.equal(job.patient.name)
        expect(json.manifest).to.equal(job.manifest)
        expect(json.status).to.equal(job.status)
        expect(json.createdAt).to.equal(job.createdAt)
        expect(json.completedAt).to.equal(job.completedAt)
        expect(json.parameters).to.deep.equal(job.parameters)
        expect(json.authorizations).to.deep.equal(job.authorizations)
        expect(json.attachments).to.deep.equal(job.attachments)
    })

    it ("byId", async () => {
        const job1: ExportJob = new ExportJob(FIRST_PATIENT_ID)
        await job1.save()
        const job2 = await ExportJob.byId(job1.id)
        expect(job2.id).to.equal(job1.id)
        expect(job2.patient.id).to.equal(job1.patient.id)
        expect(job2.patient.name).to.equal(job1.patient.name)
        expect(job2.manifest).to.equal(job1.manifest)
        expect(job2.status).to.equal(job1.status)
        expect(job2.createdAt).to.equal(job1.createdAt)
        expect(job2.completedAt).to.equal(job1.completedAt)
        expect(job2.parameters).to.deep.equal(job1.parameters)
        expect(job2.authorizations).to.deep.equal(job1.authorizations)
        expect(job2.attachments).to.deep.equal(job1.attachments)
    })

    it ("byId if job.json is missing", async () => {
        const job: ExportJob = new ExportJob(FIRST_PATIENT_ID)
        await job.save()
        await rm(Path.join(job.path), { recursive: true, force: true })
        await ExportJob.byId(job.id).then(
            () => { throw new Error("Did not throw") },
            ex => {
                expect((ex as Error).message).to.match(/Export job not found/)
            }
        )
    })

    it ("byId if job.json is messed up", async () => {
        const job: ExportJob = new ExportJob(FIRST_PATIENT_ID)
        await job.save()
        await writeFile(Path.join(job.path, "job.json"), "mess", "utf8")
        await ExportJob.byId(job.id).then(
            () => { throw new Error("Did not throw") },
            ex => {
                expect((ex as Error).message).to.match(/Export job corrupted/)
            }
        )
    })

    it ("byId if job.json is unreadable", async () => {
        const job: ExportJob = new ExportJob(FIRST_PATIENT_ID)
        await job.save()
        await chmod(Path.join(job.path, "job.json"), 222)
        await ExportJob.byId(job.id).then(
            () => { throw new Error("Did not throw") },
            ex => {
                expect((ex as Error).message).to.match(/Export job not readable/)
            }
        )
    })

    it ("byId if job.json contains invalid data", async () => {
        const job: ExportJob = new ExportJob(FIRST_PATIENT_ID)
        await job.save()
        await writeFile(Path.join(job.path, "job.json"), "{}", "utf8")
        await ExportJob.byId(job.id).then(
            () => { throw new Error("Did not throw") },
            ex => {
                expect((ex as Error).message).to.match(/Export job could not be loaded/)
            }
        )
    })

    it ("kickOff", async () => {
        const job: ExportJob = new ExportJob(FIRST_PATIENT_ID)
        await job.save()
        expect(job.manifest).to.not.exist
        await job.kickOff(SERVER.baseUrl)
        expect(job.manifest).to.exist
    })

    it ("approve before kickOff", async () => {
        const job: ExportJob = new ExportJob(FIRST_PATIENT_ID)
        job.approve().then(
            () => { throw new Error("Should have thrown") },
            err => expect(err.message).to.equal("Only retrieved jobs can be approved")
        )
    })

    it ("approve after kickOff", async () => {
        const job: ExportJob = new ExportJob(FIRST_PATIENT_ID)
        await job.save()
        expect(job.manifest).to.not.exist
        expect(job.status).to.equal("awaiting-input")
        job.kickOff(SERVER.baseUrl)
        expect(job.status).to.equal("requested")
        await waitFor(() => job.manifest)
        expect(job.status).to.equal("retrieved")
        await job.approve()
        expect(job.status).to.equal("approved")
        expect(job.manifest).to.exist
    })

    it ("rejects double approve", async () => {
        const job: ExportJob = new ExportJob(FIRST_PATIENT_ID)
        job.kickOff(SERVER.baseUrl)
        await waitFor(() => job.manifest)
        await job.approve()
        expect(job.status).to.equal("approved")
        job.approve().then(
            () => { throw new Error("Did not throw") },
            e => { expect(e.message).to.equal("Only retrieved jobs can be approved") }
        )
    })

    it ("rejects double reject", async () => {
        const job: ExportJob = new ExportJob(FIRST_PATIENT_ID)
        job.kickOff(SERVER.baseUrl)
        await waitFor(() => job.manifest)
        await job.reject()
        expect(job.status).to.equal("rejected")
        job.reject().then(
            () => { throw new Error("Did not throw") },
            e => { expect(e.message).to.equal("The job is already reject") }
        )
    })

    it ("getAugmentedManifest before adding attachments", async () => {
        const job: ExportJob = new ExportJob(FIRST_PATIENT_ID)
        expect(job.manifest).to.equal(null)
        expect(await job.getAugmentedManifest()).to.equal(null)
    })

    it ("job status lifecycle", async () => {

        // Create a job (awaiting-input) ---------------------------------------
        const job: ExportJob = new ExportJob(FIRST_PATIENT_ID)
        expect(job.status).to.equal("awaiting-input")
        expect(job.manifest).to.not.exist

        // Submit the customization form (requested) ---------------------------
        job.kickOff(SERVER.baseUrl)
        expect(job.status).to.equal("requested")
        
        // Working... ----------------------------------------------------------
        await waitFor(() => job.manifest)

        // Bulk export completed (retrieved) -----------------------------------
        expect(job.status).to.equal("retrieved")

        // Approve (approved) --------------------------------------------------
        await job.approve()
        expect(job.status).to.equal("approved")

        // Reject (rejected) ---------------------------------------------------
        job.status = "retrieved"
        await job.reject()
        expect(job.status).to.equal("rejected")
    })
})