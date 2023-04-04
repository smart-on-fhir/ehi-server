import request    from "supertest"
import { SERVER } from "./TestContext"


it ("GET /jobs", () => request(SERVER.baseUrl)
    .get("/jobs")
    .expect("content-type", /\bjson\b/)
    .expect(200));

it ("GET /jobs/:id", () => request(SERVER.baseUrl)
    .get("/jobs/xyz")
    .expect(404, /Export job not found/));

it ("POST /jobs/:id requires action parameter", () => request(SERVER.baseUrl)
    .post("/jobs/xyz")
    .expect(400, "Missing action parameter in the POST body"));

it ("POST /jobs/:id rejects invalid action parameter", () => request(SERVER.baseUrl)
    .post("/jobs/xyz")
    .send({ action: "x" })
    .expect(400, 'Invalid action parameter "x" in the POST body'));
