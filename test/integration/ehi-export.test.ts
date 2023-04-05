import { basename } from "path"
import { expect }   from "chai"
import request      from "supertest"
import jwt          from "jsonwebtoken"
import { SERVER }   from "./TestContext"
import config       from "../../config"
import EHIClient    from "./EHIClient"
import patients     from "../../data/db"

function getFirstPatientId() {
    for (const id of patients.keys()) {
        return id
    }
    throw new Error("No patients found")
}

const PATIENT_ID = getFirstPatientId()


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
        expect(result.response.status).to.equal(202)
    })

    it ('If params are passed replies with Content-Location header', async () => {
        const result = await new EHIClient().kickOff(PATIENT_ID, [{ name: "since", valueInteger: 5 }])
        expect(result.link).to.not.exist;
        expect(result.status).to.exist;
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
        const { status } = await client.kickOff(PATIENT_ID, [{ name: "since", valueInteger: 5 }])
        const manifest = await client.waitForExport(status!)
        expect(manifest).to.be.instanceOf(Object)
        expect(typeof manifest.transactionTime).to.equal("string")
        expect(manifest.requiresAccessToken).to.equal(true)
        expect(manifest.output).to.be.instanceOf(Array)
        expect(manifest.error).to.be.instanceOf(Array)
    })

    it ('Replies properly while in progress', async () => {
        const client = new EHIClient()
        const { status } = await client.kickOff(PATIENT_ID, [{ name: "since", valueInteger: 5 }])
        const res2 = await client.request(status!);
        expect(res2.status).to.equal(202);
        expect(res2.headers.get("x-progress")).to.equal("awaiting-input");
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
        const { jobId } = await client.kickOff(PATIENT_ID, [{ name: "since", valueInteger: 5 }])
        const res = await client.request(`${SERVER.baseUrl}/jobs/${jobId}/download/whatever.ndjson`);
        expect(res.status).to.equal(404);
        expect((await res.json()).resourceType).to.equal("OperationOutcome");
    })

    it ('Replies properly with ndjson files', async () => {
        const client = new EHIClient()
        const { status } = await client.kickOff(PATIENT_ID, [{ name: "since", valueInteger: 5 }])
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

    it ('Attachment files can be downloaded', async () => {
        const client = new EHIClient()
        
        // Create export
        const { status, jobId } = await client.kickOff(PATIENT_ID)

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
})

describe ("abort", () => {
    
    it ("Can abort after the export is started", async () => {
        const client = new EHIClient()
        const { jobId } = await client.kickOff(PATIENT_ID, [{ name: "since", valueInteger: 5 }])
        const result = await client.abort(jobId!)
        expect(result.status).to.equal(202)
    })

    it ("Can abort after the export is complete", async () => {
        const client = new EHIClient()
        const { jobId, status } = await client.kickOff(PATIENT_ID, [{ name: "since", valueInteger: 5 }])
        await client.waitForExport(status!)
        const result = await client.abort(jobId!)
        expect(result.status).to.equal(202)
    })

    it ("Multiple aborts cause 404 job not found errors", async () => {
        const client = new EHIClient()
        const { jobId, status } = await client.kickOff(PATIENT_ID, [{ name: "since", valueInteger: 5 }])
        await client.waitForExport(status!)
        const result = await client.abort(jobId!)
        expect(result.status).to.equal(202)
        const result2 = await client.abort(jobId!)
        expect(result2.status).to.equal(404)
    })

})
