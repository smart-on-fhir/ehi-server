import { expect } from "chai"
import request    from "supertest"
import EHIClient  from "./EHIClient"
import { FIRST_PATIENT_ID, SERVER } from "./TestContext"


it ("GET /jobs (empty)", () => request(SERVER.baseUrl)
    .get("/jobs")
    .expect("content-type", /\bjson\b/)
    .expect(200));

it ("GET /jobs", async () => {
    await new EHIClient().kickOff("123")
    await new EHIClient().kickOff("456")
    await request(SERVER.baseUrl)
        .get("/jobs")
        .expect("content-type", /\bjson\b/)
        .expect(200)
});

it ("GET /jobs/:id (empty)", () => request(SERVER.baseUrl)
    .get("/jobs/xyz")
    .expect(404, /Export job not found/));

it ("GET /jobs/:id", async () => {
    const { jobId } = await new EHIClient().kickOff("123")
    await request(SERVER.baseUrl)
        .get("/jobs/" + jobId)
        .expect("content-type", /\bjson\b/)
        .expect(200)
});


describe("Updating a job", () => {
    
    it ("Rejects on missing job", async () => {
        await request(SERVER.baseUrl)
        .post("/jobs/xyz")
        .expect(404, /Export job not found/);
    })

    it ("requires action parameter", async () => {
        const { jobId } = await new EHIClient().kickOff(FIRST_PATIENT_ID)
        await request(SERVER.baseUrl)
        .post("/jobs/" + jobId)
        .expect(400, /Missing action parameter in the POST body/);
    })

    it ("POST /jobs/:id rejects invalid action parameter", async () => {
        const { jobId } = await new EHIClient().kickOff(FIRST_PATIENT_ID)
        await request(SERVER.baseUrl)
        .post("/jobs/" + jobId)
        .send({ action: "x" })
        .expect(400, 'Invalid action parameter "x" in the POST body');
    });

    it ("POST /jobs/:id rejects invalid action parameter using multipart", async () => {
        const { jobId } = await new EHIClient().kickOff(FIRST_PATIENT_ID)
        await request(SERVER.baseUrl)
        .post("/jobs/" + jobId)
        .field("action", "x")
        .expect(400, 'Invalid action parameter "x" in the POST body');
    });

    it ("Can approve jobs", async () => {
        const { jobId } = await new EHIClient().kickOff(FIRST_PATIENT_ID)
        await request(SERVER.baseUrl)
        .post("/jobs/" + jobId)
        .send({ action: "approve" })
        .expect(200, /"status":"requested"/);
    })

    it ("Can reject jobs", async () => {
        const { jobId } = await new EHIClient().kickOff(FIRST_PATIENT_ID)
        await request(SERVER.baseUrl)
        .post("/jobs/" + jobId)
        .send({ action: "reject" })
        .expect(200, /"status":"rejected"/)
    })

    it ("Can add attachments", async () => {
        const client = new EHIClient()
        const { jobId } = await client.kickOff(FIRST_PATIENT_ID)
        const { body } = await request(SERVER.baseUrl)
        .post("/jobs/" + jobId)
        .field("action", "addAttachments")
        .attach("attachments", "test/fixtures/img3.png")
        .attach("attachments", "test/fixtures/img2.png")
        .expect(200)
        
        // Verify that the job contains attachments
        expect(body.attachments).to.be.an.instanceOf(Array)
        expect(body.attachments.length).to.equal(2)
        for (const file of body.attachments) {
            expect(file.url).to.contain(`${SERVER.baseUrl}/jobs/${jobId}/download/attachments/`)
        }
    })

    it ("Can download attachments", async () => {
        const client = new EHIClient()
        const { jobId } = await client.kickOff(FIRST_PATIENT_ID)
        const { body } = await request(SERVER.baseUrl)
        .post("/jobs/" + jobId)
        .field("action", "addAttachments")
        .attach("attachments", "test/fixtures/img3.png")
        .attach("attachments", "test/fixtures/img2.png")
        .expect(200)

        for (const file of body.attachments) {
            const res = await client.request(file.url)
            expect(res.status).to.equal(200)
        }
    })

    it ("Cannot download missing attachments", async () => {
        const client = new EHIClient()
        const { jobId } = await client.kickOff(FIRST_PATIENT_ID)
        const res = await client.request(`${SERVER.baseUrl}/jobs/${jobId}/download/attachments/whatever`)
        expect(res.status).to.equal(404)
    })

    it ("Cannot download attachments from missing jobs", async () => {
        const client = new EHIClient()
        const res = await client.request(`${SERVER.baseUrl}/jobs/abc/download/attachments/whatever`)
        expect(res.status).to.equal(404)
    })
})
