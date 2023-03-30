import request    from "supertest"
import { SERVER } from "./TestContext"


it ("GET /jobs", () => request(SERVER.baseUrl)
    .get("/jobs")
    .expect("content-type", /\bjson\b/)
    .expect(200));

it ("GET /jobs/:id", () => request(SERVER.baseUrl)
    .get("/jobs/xyz")
    .expect(404, /Export job not found/));

it ("POST /jobs/:id", () => request(SERVER.baseUrl)
    .post("/jobs/xyz")
    .expect(200, "Not implemented"));
