import request    from "supertest"
import { SERVER } from "./TestContext"


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
