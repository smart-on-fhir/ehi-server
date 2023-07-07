import { expect } from "chai"
import request    from "supertest"
import jwt        from "jsonwebtoken"
import EHIClient  from "./EHIClient"
import { FIRST_PATIENT_ID, SERVER } from "./TestContext"
import config     from "../../config"
import patients   from "../../data/db"

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

    it ('requires auth', async () => {
        await request(SERVER.baseUrl)
            .post("/fhir/Patient/123/$ehi-export")
            .expect(401, /Unauthorized! No authorization header provided in request/)
    });
    
    it ('requires valid bearer token', async () => {
        await request(SERVER.baseUrl)
            .post("/fhir/Patient/123/$ehi-export")
            .set("authorization", "Bearer xxxxx")
            .expect(401, /Invalid token/)
    });

    it ('requires valid JWT bearer', async () => {
        await request(SERVER.baseUrl)
            .post("/fhir/Patient/123/$ehi-export")
            .set("authorization", "Bearer " + jwt.sign("whatever", config.jwtSecret))
            .expect(400, /Invalid token/)
    });

    it ('If no params are passed replies with 202 and link', async () => {
        const result = await new EHIClient().kickOff(FIRST_PATIENT_ID)
        expect(result.link).to.exist;
        expect(result.status).to.exist;
        expect(result.response.status).to.equal(202)
    });

})

// TODO: direct kick-off

describe("customization parameters", () => {

    it ("rejects bad job IDs", async () => {
        const client = new EHIClient()
        const res = await client.customize("bad-id")
        expect(res.status).to.equal(404);
        expect(await res.text()).to.equal("Export job not found! Perhaps it has already completed.");
    })

    it ("accepts customization parameters", async () => {
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
        const manifest = await client.waitForExport(status!)
        expect(manifest).to.exist;
    })

    it ("rejects double customization", async () => {
        const parameters = {
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
        const client = new EHIClient()
        const { jobId } = await client.kickOff(PATIENT_ID)
        await client.customize(jobId, { parameters })
        const res = await client.customize(jobId, { parameters })
        expect(res.status).to.equal(400);
        expect(await res.text()).to.equal("Exports job already started");
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

    it ('Replies properly while in progress', async () => {
        const client = new EHIClient()
        const { status, jobId } = await client.kickOff(PATIENT_ID)
        await client.customize(jobId)
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
        const result = await client.abort(jobId!)
        expect(result.status).to.equal(202)
    })

    it ("Can abort after the export is completed", async () => {
        const client = new EHIClient()
        const { jobId, status } = await client.kickOff(PATIENT_ID)
        await client.customize(jobId)
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
        await client.waitForExport(status!)
        const result = await client.abort(jobId!)
        expect(result.status).to.equal(202)
        const result2 = await client.abort(jobId!)
        expect(result2.status).to.equal(404)
    })

})

describe("POST /admin/login", () => {
    it("Rejects empty body", async () => {
        await request(SERVER.baseUrl)
            .post("/admin/login")
            .expect(401)
            .expect({ error: "Invalid username or password" })
    });

    it("Rejects missing username", async () => {
        await request(SERVER.baseUrl)
            .post("/admin/login")
            .send("password=whatever")
            .expect(401)
            .expect({ error: "Invalid username or password" })
    });

    it("Rejects missing password", async () => {
        await request(SERVER.baseUrl)
            .post("/admin/login")
            .send("username=admin")
            .expect(401)
            .expect({ error: "Invalid username or password" })
    });

    it("Rejects invalid username", async () => {
        await request(SERVER.baseUrl)
            .post("/admin/login")
            .send("username=whatever&password=whatever")
            .expect(401)
            .expect({ error: "Invalid username or password" })
    });

    it("Rejects invalid password", async () => {
        await request(SERVER.baseUrl)
            .post("/admin/login")
            .send("username=admin&password=whatever")
            .expect(401)
            .expect({ error: "Invalid username or password" })
    });

    it("User can login", async () => {
        await request(SERVER.baseUrl)
            .post("/admin/login")
            .send("username=admin&password=admin-password")
            .expect(200)
            .expect("set-cookie", /^sid=.+?;\s*Path=\/;\s*HttpOnly$/)
            .expect({ username: 'admin' })
    });

    it("Can create long sessions", async () => {
        await request(SERVER.baseUrl)
            .post("/admin/login")
            .send("username=admin&password=admin-password&remember=true")
            .expect(200)
            .expect("set-cookie", /^sid=.+?;\s*Path=\/;\s*Expires=.+?;\s*HttpOnly$/)
            .expect({ username: 'admin' })
    });
})

describe("GET /admin/logout", () => {
    it("Rejects unauthorized users body", async () => {
        await request(SERVER.baseUrl).get("/admin/logout").expect(401)
    });

    it("Patient can logout", async () => {
        config.users[0].sid = "TEST_SID";
        await request(SERVER.baseUrl)
            .get("/admin/logout")
            .set("Cookie", ["sid=TEST_SID"])
            .send()
            .expect(200)
            .expect("Logout successful");
        expect(config.users[0].sid).to.be.undefined
    });
})

// TODO: describe("GET /admin/jobs", () => {})

describe("GET /admin/jobs/:id", () => {

    async function fetchJob(id: string) {
        config.users[0].sid = "TEST_SID";
        return fetch(`${SERVER.baseUrl}/admin/jobs/${id}`, {
            headers: { cookie: "sid=TEST_SID" }
        })
    }

    it ("rejects bad job IDs", async () => {
        const res = await fetchJob("bad-id")
        expect(res.status).to.equal(404);
        expect(await res.text()).to.equal("Export job not found! Perhaps it has already completed.");
    })

    it ("provides metadata after export is complete", async () => {
        const client = new EHIClient()
        const { status, jobId } = await client.kickOff(PATIENT_ID)
        await client.customize(jobId)
        const metaRes1 = await fetchJob(jobId)
        expect(metaRes1.status).to.equal(200);
        expect((await metaRes1.json()).manifest).to.be.null;
        await client.waitForExport(status!)
        const metaRes2 = await fetchJob(jobId)
        expect(metaRes2.status).to.equal(200);
        expect((await metaRes2.json()).manifest).to.not.be.null;
    })
})

// TODO: describe("DELETE /admin/jobs/:id", () => {})

describe("POST /admin/jobs/:id/approve", () => {

    it("Rejects for missing jobs", async () => {
        config.users[0].sid = "TEST_SID";
        await request(SERVER.baseUrl)
            .post("/admin/jobs/bad-id/approve")
            .set("Cookie", ["sid=TEST_SID"])
            .send()
            .expect(404)
    })

    it ("Works", async () => {
        const client = new EHIClient()
        const { jobId } = await client.kickOff(PATIENT_ID)
        await client.customize(jobId)

        config.users[0].sid = "TEST_SID";
        await request(SERVER.baseUrl)
            .post("/admin/jobs/"+jobId+"/approve")
            .set("Cookie", ["sid=TEST_SID"])
            .send()
            .expect(/"status":\s*"approved"/)
    })
})

describe("POST /admin/jobs/:id/reject", () => {
    it("Rejects for missing jobs", async () => {
        config.users[0].sid = "TEST_SID";
        await request(SERVER.baseUrl)
            .post("/admin/jobs/bad-id/reject")
            .set("Cookie", ["sid=TEST_SID"])
            .send()
            .expect(404)
    })

    it ("Works", async () => {
        const client = new EHIClient()
        const { jobId } = await client.kickOff(PATIENT_ID)
        await client.customize(jobId)

        config.users[0].sid = "TEST_SID";
        await request(SERVER.baseUrl)
            .post("/admin/jobs/"+jobId+"/reject")
            .set("Cookie", ["sid=TEST_SID"])
            .send()
            .expect(/"status":\s*"rejected"/)
    })
})
// TODO: describe("POST /admin/jobs/:id/add-files", () => {})
// TODO: describe("POST /admin/jobs/:id/remove-files", () => {})
// TODO: describe("GET /admin/jobs/:id/download", () => {})
// TODO: describe("GET /admin/jobs/:id/download/:file", () => {})
// TODO: describe("GET /admin/jobs/:id/download/attachments/:file", () => {})
