import request    from "supertest"
import EHIClient from "./EHIClient"
import { SERVER, FIRST_PATIENT_ID } from "./TestContext"


describe("renders html pages", () => {

    it ("/", () => request(SERVER.baseUrl)
        .get("/")
        .expect('Content-Type', /html/)
        .expect(200));

    it ("/authorize-app", () => request(SERVER.baseUrl)
        .get("/authorize-app")
        .expect('Content-Type', /html/)
        .expect(200));

    it ("/patient-login", () => request(SERVER.baseUrl)
        .get("/patient-login")
        .expect('Content-Type', /html/)
        .expect(200));
    
    it ("/jobs/:id/customize", () => request(SERVER.baseUrl)
        .get("/jobs/abc/customize")
        .expect(404)); // No "abc" job found
    
    it ("/jobs/:id/customize redirects to patient login if needed", async () => {
        const client = new EHIClient()
        const { jobId } = await client.kickOff(FIRST_PATIENT_ID)
        await request(SERVER.baseUrl)
            .get(`/jobs/${jobId}/customize`)
            .redirects(0)
            .expect("location", /^\/patient-login\?action=.+/)
            .expect(302);
    })

    it ("/jobs/:id/customize does not redirect if _patient param is set", async () => {
        const client = new EHIClient()
        const { jobId } = await client.kickOff(FIRST_PATIENT_ID)
        await request(SERVER.baseUrl)
            .get(`/jobs/${jobId}/customize?_patient=${FIRST_PATIENT_ID}`)
            .redirects(0)
            .expect(200)
    })
})

describe("Capability statement", () => {

    it ('Replies with json', () => request(SERVER.baseUrl)
        .get("/fhir/metadata")
        .expect('Content-Type', /json/)
        .expect(200));

    it ('Capability statement rejects unsupported _format params', () => request(SERVER.baseUrl)
        .get("/fhir/metadata?_format=xyz")
        .expect(400, `Unsupported _format parameter "xyz"`));

    it ('Capability statement rejects unsupported accept header', () => request(SERVER.baseUrl)
        .get("/fhir/metadata")
        .set("accept", "xyz")
        .expect(400, `Unsupported value "xyz" in accept header`));

})

describe(".well-known/smart-configuration", () => {
    it ('Replies with json', () => request(SERVER.baseUrl)
        .get("/fhir/.well-known/smart-configuration")
        .expect('Content-Type', /json/)
        .expect(200));
})
