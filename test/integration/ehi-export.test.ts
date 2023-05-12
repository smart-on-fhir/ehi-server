import { basename } from "path"
import { expect }   from "chai"
import request      from "supertest"
import jwt          from "jsonwebtoken"
import EHIClient    from "./EHIClient"
import { SERVER }   from "./TestContext"
import config       from "../../config"
import patients     from "../../data/db"

function getPatientIdAt(index:number) {
    let i = 0
    for (const id of patients.keys()) {
        if (index === i++) {
            return id
        }
    }
    throw new Error(`No patient found at index ${index}`)
}

const PATIENT_ID = getPatientIdAt(0)


describe("Kick off", () => {

    it ('requires auth', () => request(SERVER.baseUrl)
        .post("/fhir/Patient/123/$ehi-export")
        .expect(401, /Unauthorized! No authorization header provided in request/));
    
    it ('requires valid bearer token', () => request(SERVER.baseUrl)
        .post("/fhir/Patient/123/$ehi-export")
        .set("authorization", "Bearer xxxxx")
        .expect(401, /Invalid token/));

    it ('requires valid JWT bearer', () => request(SERVER.baseUrl)
        .post("/fhir/Patient/123/$ehi-export")
        .set("authorization", "Bearer " + jwt.sign("whatever", config.jwtSecret))
        .expect(400, /Invalid token/));

    it ('If no params are passed replies with 202 and link', async () => {
        const result = await new EHIClient().kickOff("123")
        expect(result.link).to.exist;
        expect(result.status).to.exist;
        expect(result.response.status).to.equal(202)
    })

    it ('accepts customization parameters', async () => {
        const client = new EHIClient()
        const { jobId, status } = await client.kickOff(PATIENT_ID)
        await client.customize(jobId, {
            parameters: {
                medicalRecord    : { enabled: true, from: "2019-01-01", to: "2020-01-01", name: "Medical Record"    },
                visits           : { enabled: true, from: "2019-01-01", to: "2020-01-01", name: "Clinic Visits"     },
                dischargeSummary : { enabled: true, from: "2019-01-01", to: "2020-01-01", name: "Discharge Summary" },
                labs             : { enabled: true, from: "2019-01-01", to: "2020-01-01", name: "Lab Reports"       },
                operative        : { enabled: true, from: "2019-01-01", to: "2020-01-01", name: "Operative Reports" },
                pathology        : { enabled: true, from: "2019-01-01", to: "2020-01-01", name: "Pathology Reports" },
                radiation        : { enabled: true, from: "2019-01-01", to: "2020-01-01", name: "Radiation Reports" },
                radiology        : { enabled: true, from: "2019-01-01", to: "2020-01-01", name: "Radiology Reports" },
                photographs      : { enabled: true, from: "2019-01-01", to: "2020-01-01", name: "Photographs"       },
                billing          : { enabled: true, from: "2019-01-01", to: "2020-01-01", name: "Billing Records"   },
                other            : { enabled: true, from: "2019-01-01", to: "2020-01-01", name: "Other"             }
            }
        })

        await client.approve(jobId)
        const manifest = await client.waitForExport(status!)
        // console.log(manifest)
        expect(manifest).to.exist;

    })
})

describe ("status", () => {
    
    it ('Replies with 404 and OperationOutcome for invalid job IDs', async () => {
        const res = await new EHIClient().request(SERVER.baseUrl + "/jobs/123/status");
        expect(res.status).to.equal(404);
        expect((await res.json()).resourceType).to.equal("OperationOutcome");
    })

    it ('Can fetch manifest', async () => {
        const client = new EHIClient()
        const { status, jobId } = await client.kickOff(PATIENT_ID)
        await client.customize(jobId)
        await client.approve(jobId)
        const manifest = await client.waitForExport(status!)
        expect(manifest).to.be.instanceOf(Object)
        expect(typeof manifest.transactionTime).to.equal("string")
        expect(manifest.requiresAccessToken).to.equal(true)
        expect(manifest.output).to.be.instanceOf(Array)
        expect(manifest.error).to.be.instanceOf(Array)
    })

    it ('Replies properly while awaiting input', async () => {
        const client = new EHIClient()
        const { status } = await client.kickOff(PATIENT_ID)
        const res2 = await client.request(status!);
        expect(res2.status).to.equal(202);
        expect(res2.headers.get("x-progress")).to.equal("awaiting-input");
        expect(res2.headers.get("retry-after")).to.exist;
    })

    it ('Replies properly while in awaiting approval', async () => {
        const client = new EHIClient()
        const { status, jobId } = await client.kickOff(PATIENT_ID)
        await client.customize(jobId)
        const res2 = await client.request(status!);
        expect(res2.status).to.equal(202);
        expect(res2.headers.get("x-progress")).to.equal("in-review");
        expect(res2.headers.get("retry-after")).to.exist;
    })

    it ('Replies properly while in progress', async () => {
        const client = new EHIClient()
        const { status, jobId } = await client.kickOff(PATIENT_ID)
        await client.customize(jobId)
        await client.approve(jobId)
        const res2 = await client.request(status!);
        expect(res2.status).to.equal(202);
        expect(res2.headers.get("x-progress")).to.equal("requested");
        expect(res2.headers.get("retry-after")).to.exist;
    })
})


describe ("download", () => {
    
    it ('Replies with 404 and OperationOutcome for invalid job IDs', async () => {
        const res = await new EHIClient().request(SERVER.baseUrl + "/jobs/123/download/resourceType");
        expect(res.status).to.equal(404);
        expect((await res.json()).resourceType).to.equal("OperationOutcome");
    })

    it ('Replies with 404 and OperationOutcome for invalid file name', async () => {
        const client = new EHIClient()
        const { jobId } = await client.kickOff(PATIENT_ID)
        await client.customize(jobId)
        const res = await client.request(`${SERVER.baseUrl}/jobs/${jobId}/download/whatever.ndjson`);
        expect(res.status).to.equal(404);
        expect((await res.json()).resourceType).to.equal("OperationOutcome");
    })

    it ('Replies properly with ndjson files', async () => {
        const client = new EHIClient()
        const { status, jobId } = await client.kickOff(PATIENT_ID)
        await client.customize(jobId)
        await client.approve(jobId)
        const manifest = await client.waitForExport(status!)
        expect(manifest).to.exist;
        const url = manifest.output.find((x: any) => x.type === "Patient")!.url
        const res3 = await client.request(url);
        expect(res3.headers.get("content-type")).to.equal("application/fhir+ndjson");
        expect(res3.headers.get("content-disposition")).to.equal("attachment");
        const ndjson = await res3.text()
        const lines = ndjson.trim().split("\n")
        expect(lines.length).to.equal(1)
        expect(() => lines.map(l => JSON.parse(l))).not.to.throw
        expect(JSON.parse(lines[0]).id).to.equal(PATIENT_ID)
    })

    it ('Adding attachment requires file upload', async () => {
        const client = new EHIClient()
        const { jobId } = await client.kickOff(PATIENT_ID)
        await request(SERVER.baseUrl)
            .post("/jobs/" + jobId)
            .field("action", "addAttachments")
            .expect(400, 'The "addAttachments" action requires that one more files are upload via the "attachments" field')
    })

    it ('Attachment files can be downloaded', async () => {
        const client = new EHIClient()
        
        // Create export
        const { status, jobId } = await client.kickOff(PATIENT_ID)

        await client.customize(jobId)

        // Add files
        await request(SERVER.baseUrl)
        .post("/jobs/" + jobId)
        .field("action", "addAttachments")
        .attach("attachments", "test/fixtures/img3.png")
        .attach("attachments", "test/fixtures/img2.png")
        .expect(200)

        // Approve
        await request(SERVER.baseUrl).post("/jobs/" + jobId).field("action", "approve")

        // Fetch the manifest
        const manifest = await client.waitForExport(status!)

        // console.log(manifest)
        expect(manifest).to.exist;

        // Fetch the DocumentReference
        const docRefEntry = manifest.output.find(x => x.type == "DocumentReference")
        expect(docRefEntry).to.exist;
        const res = await client.request(docRefEntry!.url)
        const txt = await res.text()
        const lines = txt.trim().split(/\n/).filter(Boolean)
        expect(lines.length).to.equal(1)
        const docRef = JSON.parse(lines[0])

        // console.log(docRef.content)
        expect(docRef.content.length).to.equal(2)
        docRef.content.forEach((f: any) => {
            expect(f.attachment.url).to.contain(`${SERVER.baseUrl}/jobs/${jobId}/download/attachments/`)
        })
    })

    it ("Can remove attachments", async () => {
        const client = new EHIClient()
        const { jobId } = await client.kickOff("fake-patient-id")
        const { body: job } = await request(SERVER.baseUrl)
        .post("/jobs/" + jobId)
        .field("action", "addAttachments")
        .attach("attachments", "test/fixtures/img3.png")
        .attach("attachments", "test/fixtures/img2.png")
        .expect(200)

        const { body } = await request(SERVER.baseUrl)
        .post("/jobs/" + jobId)
        .send({ action: "removeAttachments", params: [ basename(job.attachments[0].url) ]})
        .expect(200)
        
        // Verify that the job contains attachments
        expect(body.attachments).to.be.an.instanceOf(Array)
        expect(body.attachments.length).to.equal(1)
        expect(body.attachments[0].url).to.contain(`${SERVER.baseUrl}/jobs/${jobId}/download/attachments/`)
    })

    it ("Can't remove attachments form rejected jobs", async () => {
        const client = new EHIClient()
        const { jobId } = await client.kickOff("fake-patient-id")

        await request(SERVER.baseUrl)
            .post("/jobs/" + jobId)
            .send({ action: "reject" })
            .expect(200)

        await request(SERVER.baseUrl)
            .post("/jobs/" + jobId)
            .send({ action: "removeAttachments", params: [ "whatever" ]})
            .expect(400, `Cannot remove attachments from export in "rejected" state`)
    })

    it ("Can't remove attachments form approved jobs", async () => {
        const client = new EHIClient()
        const { jobId } = await client.kickOff("fake-patient-id")

        await client.customize(jobId)

        await request(SERVER.baseUrl)
            .post("/jobs/" + jobId)
            .send({ action: "approve" })
            .expect(200)

        await request(SERVER.baseUrl)
            .post("/jobs/" + jobId)
            .send({ action: "removeAttachments", params: [ "whatever" ]})
            .expect(400, `Cannot remove attachments from export in "requested" state`)
    })

    it ('Exports can be downloaded', async () => {
        const client = new EHIClient()
        const { status, jobId } = await client.kickOff(PATIENT_ID)
        await client.customize(jobId)
        await request(SERVER.baseUrl).post("/jobs/" + jobId).field("action", "approve")
        await client.waitForExport(status!)
        await request(SERVER.baseUrl)
            .get("/jobs/" + jobId + "/download")
            .expect(200)
            .expect('content-type', 'application/zip')
            .expect('content-disposition', /^attachment; filename=/)
    })
})

describe ("abort", () => {
    
    it ("Can abort after the export is started", async () => {
        const client = new EHIClient()
        const { jobId } = await client.kickOff(PATIENT_ID)
        const result = await client.abort(jobId!)
        expect(result.status).to.equal(202)
    })

    it ("Can abort after the export is approved", async () => {
        const client = new EHIClient()
        const { jobId } = await client.kickOff(PATIENT_ID)
        await client.customize(jobId)
        await client.approve(jobId)
        const result = await client.abort(jobId!)
        expect(result.status).to.equal(202)
    })

    it ("Can abort after the export is completed", async () => {
        const client = new EHIClient()
        const { jobId, status } = await client.kickOff(PATIENT_ID)
        await client.customize(jobId)
        await client.approve(jobId)
        await client.waitForExport(status!)
        const result = await client.abort(jobId!)
        expect(result.status).to.equal(202)
    })

    it ("Abort rejects for missing jobs", async () => {
        const client = new EHIClient()
        const result = await client.abort("x")
        expect(result.status).to.equal(404)
    })

    it ("Multiple aborts cause 404 job not found errors", async () => {
        const client = new EHIClient()
        const { jobId, status } = await client.kickOff(PATIENT_ID)
        await client.customize(jobId)
        await client.approve(jobId)
        await client.waitForExport(status!)
        const result = await client.abort(jobId!)
        expect(result.status).to.equal(202)
        const result2 = await client.abort(jobId!)
        expect(result2.status).to.equal(404)
    })

})
