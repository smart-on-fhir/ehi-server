import { expect }                          from "chai"
import request                             from "supertest"
import jwt                                 from "jsonwebtoken"
import EHIClient                           from "./EHIClient"
import { FIRST_PATIENT_ID, login, SERVER } from "./TestContext"
import config                              from "../../config"
import patients                            from "../../data/db"
import { SESSIONS }                        from "../../lib/utils"

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
        for (const url of [
            "/fhir/Patient/123/$ehi-export",
            "/auto-approve/fhir/Patient/123/$ehi-export",
            "/no-form/fhir/Patient/123/$ehi-export",
            "/no-form/auto-approve/fhir/Patient/123/$ehi-export",
            "/auto-approve/no-form/fhir/Patient/123/$ehi-export"
        ]) {
            await request(SERVER.baseUrl)
                .post(url)
                .expect(401, /Unauthorized! No authorization header provided in request/)
        }
    });
    
    it ('requires valid bearer token', async () => {
        for (const url of [
            "/fhir/Patient/123/$ehi-export",
            "/auto-approve/fhir/Patient/123/$ehi-export",
            "/no-form/fhir/Patient/123/$ehi-export",
            "/no-form/auto-approve/fhir/Patient/123/$ehi-export",
            "/auto-approve/no-form/fhir/Patient/123/$ehi-export"
        ]) {
            await request(SERVER.baseUrl)
                .post(url)
                .set("authorization", "Bearer xxxxx")
                .expect(401, /Invalid token/)
        }
    });

    it ('requires valid JWT bearer', async () => {
        for (const url of [
            "/fhir/Patient/123/$ehi-export",
            "/auto-approve/fhir/Patient/123/$ehi-export",
            "/no-form/fhir/Patient/123/$ehi-export",
            "/no-form/auto-approve/fhir/Patient/123/$ehi-export",
            "/auto-approve/no-form/fhir/Patient/123/$ehi-export"
        ]) {
            await request(SERVER.baseUrl)
                .post(url)
                .set("authorization", "Bearer " + jwt.sign("whatever", config.jwtSecret))
                .expect(400, /Invalid token/)
        }
    });

    it ('If no params are passed replies with 202 and Content-Location header', async () => {
        for (const prefix of [
            "",
            "auto-approve/",
            "no-form/",
            "no-form/auto-approve/",
            "auto-approve/no-form/"
        ]) {
            const result = await new EHIClient().kickOff(FIRST_PATIENT_ID, prefix)
            expect(result.status).to.exist;
            expect(result.response.status).to.equal(202)
        }
    });

    it ("kick-off @ no-form", async () => {
        for (const prefix of [
            "no-form/auto-approve/",
            "auto-approve/no-form/"
        ]) {
            const client = new EHIClient()
            const { jobId, link, status } = await client.kickOff(FIRST_PATIENT_ID, prefix)
            expect(link).to.not.exist;

            const res = await client.request(status)
            expect(res.ok).to.equal(true)
            expect(res.headers.has("link"), "The status endpoint should not include a link header").to.equal(false)

            await client.waitForStatus(jobId, "approved")
            await client.approve(jobId)
            
            const manifest = await client.waitForExport(status)
            expect(manifest).to.exist
        }

        const client = new EHIClient()
        const { jobId, link, status } = await client.kickOff(FIRST_PATIENT_ID, "no-form/")
        expect(link).to.not.exist;

        const res = await client.request(status)
        expect(res.ok).to.equal(true)
        expect(res.headers.has("link"), "The status endpoint should not include a link header").to.equal(false)

        await client.waitForStatus(jobId, "retrieved")
        await client.approve(jobId)
        
        const manifest = await client.waitForExport(status)
        expect(manifest).to.exist
    });

    it ("kick-off @ auto-approve", async () => {
        const client = new EHIClient()
        const { jobId, status, response } = await client.kickOff(FIRST_PATIENT_ID, "auto-approve/")
        expect(status).to.exist;
        expect(response.status).to.equal(202)    
        await client.customize(jobId)
        await client.waitForStatus(jobId, "approved")
        const manifest = await client.waitForExport(status)
        expect(manifest).to.exist
    })

    it ("kick-off @ no-form/auto-approve", async () => {
        const client = new EHIClient()
        const { jobId, status, response } = await client.kickOff(FIRST_PATIENT_ID, "no-form/auto-approve/")
        expect(status).to.exist;
        expect(response.status).to.equal(202)    
        await client.waitForStatus(jobId, "approved")
        const manifest = await client.waitForExport(status)
        expect(manifest).to.exist
    });

    it ("kick-off @ auto-approve/no-form", async () => {
        const client = new EHIClient()
        const { jobId, status, response } = await client.kickOff(FIRST_PATIENT_ID, "auto-approve/no-form/")
        expect(status).to.exist;
        expect(response.status).to.equal(202)    
        await client.waitForStatus(jobId, "approved")
        const manifest = await client.waitForExport(status)
        expect(manifest).to.exist
    });
})

describe("customization parameters", () => {

    it ("rejects bad job IDs", async () => {
        const client = new EHIClient()
        const res = await client.customize("bad-id")
        expect(res.status).to.equal(404);
        expect(await res.text()).to.equal("Export job not found!");
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
        
        await client.waitForStatus(jobId, "retrieved")
        await client.approve(jobId)
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
        expect(await res.text()).to.equal("Exports job already customized");
    })

    it ("Includes link header in the status endpoint if needed", async () => {
        const client = new EHIClient()
        const { status } = await client.kickOff(PATIENT_ID)
        const res = await client.request(status)
        const link = res.headers.get("Link")
        expect(link).to.exist;
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
        await client.waitForStatus(jobId, "retrieved")
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
        const res = await new EHIClient().request(SERVER.baseUrl + "/jobs/123/download/resourceType.ndjson");
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
        await client.waitForStatus(jobId, "retrieved")
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

    it ('Downloading attachments', async () => {
        
        // Create export and wait for the bulk part to complete
        // ---------------------------------------------------------------------
        const client = new EHIClient()
        const { status, jobId } = await client.kickOff(PATIENT_ID)
        await client.customize(jobId)
        await client.waitForStatus(jobId, "retrieved")
        
        // Upload 2 files
        // ---------------------------------------------------------------------
        login()
        await request(SERVER.baseUrl)
            .post(`/admin/jobs/${jobId}/add-files`)
            .set('Cookie', ['sid=TEST_SID'])
            .attach("attachments", "test/fixtures/img3.png")
            .attach("attachments", "test/fixtures/img2.png")
            .expect(200)

        // Approve export and fetch the manifest
        // ---------------------------------------------------------------------
        await client.approve(jobId)
        const manifest = await client.waitForExport(status!)
        // console.log(manifest)
        expect(manifest).to.exist;
        expect(manifest.output).to.be.instanceOf(Array)
        expect(manifest.output.length).to.equal(6)
        
        // Download and validate Patient.ndjson
        // ---------------------------------------------------------------------
        const url = manifest.output.find((x: any) => x.type === "Patient")!.url
        const res3 = await client.request(url);
        expect(res3.headers.get("content-type")).to.equal("application/fhir+ndjson");
        expect(res3.headers.get("content-disposition")).to.equal("attachment");
        const ndjson = await res3.text()
        const lines = ndjson.trim().split("\n")
        expect(lines.length).to.equal(1)
        expect(() => lines.map(l => JSON.parse(l))).not.to.throw
        expect(JSON.parse(lines[0]).id).to.equal(PATIENT_ID)

        // Download and validate attachments.DocumentReference.ndjson
        // ---------------------------------------------------------------------
        const entry = manifest.output.find((x: any) => x.type === "DocumentReference")!
        expect(entry).to.exist
        expect(entry.url).to.match(/\battachments\.DocumentReference\.ndjson$/)
        expect(entry.count).to.equal(2)
        const res4 = await client.request(entry.url);
        const ndjson2 = await res4.text()
        const lines2 = ndjson2.trim().split("\n")
        expect(lines.length).to.equal(1)
        const { content } = JSON.parse(lines2[0])
        for (const item of content) {
            const res = await client.request(item.attachment.url);
            expect(res.headers.get("content-type")).to.equal(item.attachment.contentType);
            expect(res.headers.get("content-length")).to.equal(item.attachment.size + "");
        }
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
        await client.waitForStatus(jobId, "retrieved")
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
        await client.waitForStatus(jobId, "retrieved")
        await client.approve(jobId)
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
            .expect("set-cookie", /^sid=.+?/)
            .expect({ username: 'admin' })
    });

    it("Can create long sessions", async () => {
        await request(SERVER.baseUrl)
            .post("/admin/login")
            .send("username=admin&password=admin-password&remember=true")
            .expect(200)
            .expect("set-cookie", /^sid=.+?;\s*Path=\/;\s*Expires=.+?/)
            .expect({ username: 'admin' })
    });
})

describe("GET /admin/logout", () => {
    it("Rejects unauthorized users body", async () => {
        await request(SERVER.baseUrl).get("/admin/logout").expect(401)
    });

    it("Patient can logout", async () => {
        login()
        await request(SERVER.baseUrl)
            .get("/admin/logout")
            .set("Cookie", ["sid=TEST_SID"])
            .send()
            .expect(200)
            .expect("Logout successful");
        expect(SESSIONS.find(s => s.sid === "TEST_SID")).to.be.undefined
    });
})

describe("GET /admin/jobs", () => {
    it ("Requires authentication", async () => {
        await request(SERVER.baseUrl).get("/admin/jobs").expect(401)
    });

    it ("Rejects unknown users", async () => {
        await request(SERVER.baseUrl).get("/admin/jobs").set('Cookie', ['sid=whatever']).expect(401)
    });

    it ("Works", async () => {
        login()
        await request(SERVER.baseUrl).get("/admin/jobs").set('Cookie', ['sid=TEST_SID']).expect(200)
    })
})

describe("GET /admin/jobs/:id", () => {

    async function fetchJob(id: string) {
        login()
        return fetch(`${SERVER.baseUrl}/admin/jobs/${id}`, {
            headers: { cookie: "sid=TEST_SID" }
        })
    }

    it ("rejects bad job IDs", async () => {
        const res = await fetchJob("bad-id")
        expect(res.status).to.equal(404);
        expect(await res.text()).to.equal("Export job not found!");
    })

    it ("provides metadata after export is complete", async () => {
        const client = new EHIClient()
        const { status, jobId } = await client.kickOff(PATIENT_ID)
        await client.customize(jobId)
        const metaRes1 = await fetchJob(jobId)
        expect(metaRes1.status).to.equal(200);
        expect((await metaRes1.json()).manifest).to.be.null;
        await client.waitForStatus(jobId, "retrieved")
        await client.approve(jobId)
        await client.waitForExport(status!)
        const metaRes2 = await fetchJob(jobId)
        expect(metaRes2.status).to.equal(200);
        expect((await metaRes2.json()).manifest).to.not.be.null;
    })
})

describe("POST /admin/jobs/:id/approve", () => {

    it("Rejects for missing jobs", async () => {
        login()
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
        await client.waitForStatus(jobId, "retrieved")

        login()
        await request(SERVER.baseUrl)
            .post("/admin/jobs/"+jobId+"/approve")
            .set("Cookie", ["sid=TEST_SID"])
            .send()
            .expect(/"status":\s*"approved"/)
    })
})

describe("POST /admin/jobs/:id/reject", () => {
    
    it("Rejects for missing jobs", async () => {
        login()
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
        await client.waitForStatus(jobId, "retrieved")

        login()
        await request(SERVER.baseUrl)
            .post("/admin/jobs/"+jobId+"/reject")
            .set("Cookie", ["sid=TEST_SID"])
            .send()
            .expect(/"status":\s*"rejected"/)
    })
})

describe("POST /admin/jobs/:id/add-files", () => {
    it("Rejects for missing jobs", async () => {
        login()
        await request(SERVER.baseUrl)
            .post("/admin/jobs/123/add-files")
            .set('Cookie', ['sid=TEST_SID'])
            .expect(404)
    });

    it("Requires authentication", async () => {
        await request(SERVER.baseUrl)
            .post("/admin/jobs/123/add-files")
            .send()
            .expect(401)
    });

    it("Rejects unknown users", async () => {
        await request(SERVER.baseUrl)
            .post("/admin/jobs/123/add-files")
            .set('Cookie', ['sid=whatever'])
            .expect(401)
    });

    it("Rejects if no files are uploaded", async () => {
        const client = new EHIClient()
        const { jobId } = await client.kickOff(PATIENT_ID)
        await client.customize(jobId)
        login()
        await request(SERVER.baseUrl)
            .post(`/admin/jobs/${jobId}/add-files`)
            .set('Cookie', ['sid=TEST_SID'])
            .expect(400, 'Called "addFiles" without uploaded "attachments"')
    });

    it ("Rejects if the job is not in retrieved state", async () => {
        const client = new EHIClient()
        const { jobId } = await client.kickOff(PATIENT_ID)
        login()
        await request(SERVER.baseUrl)
            .post(`/admin/jobs/${jobId}/add-files`)
            .set('Cookie', ['sid=TEST_SID'])
            .attach("attachments", "test/fixtures/img3.png")
            .expect(400, 'Cannot add attachments to export in "awaiting-input" state')
    });

    it("Works as expected", async () => {
        const client = new EHIClient()
        const { jobId, status } = await client.kickOff(PATIENT_ID)
        await client.customize(jobId)
        await client.waitForStatus(jobId, "retrieved")
        
        login()

        await request(SERVER.baseUrl)
            .post(`/admin/jobs/${jobId}/add-files`)
            .set('Cookie', ['sid=TEST_SID'])
            .attach("attachments", "test/fixtures/img3.png")
            .attach("attachments", "test/fixtures/img2.png")
            .expect(200)
            .expect(res => {
                // console.log("after upload:", res.error)
                const { output } = res.body.manifest
                expect(output).to.be.instanceOf(Array)
                expect(output.length).to.equal(6)
                const entry = output.find((x: any) => x.type === "DocumentReference")
                expect(entry).to.exist
                expect(entry.url).to.match(/\battachments\.DocumentReference\b/)
                expect(entry.count).to.equal(2)
            })
        
        await (await client.approve(jobId)).json()
        await client.waitForExport(status)
        
        
    });
})

describe("POST /admin/jobs/:id/remove-files", () => {
    
    it("Rejects for missing jobs", async () => {
        login()
        await request(SERVER.baseUrl)
            .post("/admin/jobs/123/remove-files")
            .set('Cookie', ['sid=TEST_SID'])
            .expect(404)
    });

    it("Requires authentication", async () => {
        await request(SERVER.baseUrl)
            .post("/admin/jobs/123/remove-files")
            .expect(401)
    });

    it("Rejects unknown users", async () => {
        await request(SERVER.baseUrl)
            .post("/admin/jobs/123/remove-files")
            .set('Cookie', ['sid=whatever'])
            .expect(401)
    });

    it("Ignores missing files", async () => {
        const client = new EHIClient()
        const { jobId } = await client.kickOff(PATIENT_ID)
        await client.customize(jobId)
        await client.waitForStatus(jobId, "retrieved")
        login()

        await request(SERVER.baseUrl)
            .post(`/admin/jobs/${jobId}/remove-files`)
            .set('Cookie', ['sid=TEST_SID'])
            .send({ params: ["img3.png"] })
            .expect(200)

    });

    it("Ignores empty params", async () => {
        const client = new EHIClient()
        const { jobId } = await client.kickOff(PATIENT_ID)
        await client.customize(jobId)
        await client.waitForStatus(jobId, "retrieved")

        login()

        await request(SERVER.baseUrl)
            .post(`/admin/jobs/${jobId}/remove-files`)
            .set('Cookie', ['sid=TEST_SID'])
            .send({ params: [] })
            .expect(200)
    });

    it("Ignores missing params", async () => {
        const client = new EHIClient()
        const { jobId } = await client.kickOff(PATIENT_ID)
        await client.customize(jobId)
        await client.waitForStatus(jobId, "retrieved")

        login()

        await request(SERVER.baseUrl)
            .post(`/admin/jobs/${jobId}/remove-files`)
            .set('Cookie', ['sid=TEST_SID'])
            .expect(200)
    });

    it ("Rejects if the job is not in retrieved state", async () => {
        const client = new EHIClient()
        const { jobId } = await client.kickOff(PATIENT_ID)
        login()
        await request(SERVER.baseUrl)
            .post(`/admin/jobs/${jobId}/remove-files`)
            .set('Cookie', ['sid=TEST_SID'])
            .send({ params: [ "some-file" ] })
            .expect(400, 'Cannot remove attachments from export in "awaiting-input" state')
    });

    it("Works as expected", async () => {
        const client = new EHIClient()
        const { jobId } = await client.kickOff(PATIENT_ID)
        await client.customize(jobId)
        await client.waitForStatus(jobId, "retrieved")

        login()

        let res = await request(SERVER.baseUrl)
            .post(`/admin/jobs/${jobId}/add-files`)
            .set('Cookie', ['sid=TEST_SID'])
            .attach("attachments", "test/fixtures/img3.png")
            .attach("attachments", "test/fixtures/img2.png")
            .expect(200)
            .expect(res => {
                // console.log("after upload:", JSON.stringify(res.body, null, 4))
                const { output } = res.body.manifest
                expect(output).to.be.instanceOf(Array)
                expect(output.length).to.equal(6)
                const entry = output.find((x: any) => x.type === "DocumentReference")
                expect(entry).to.exist
                expect(entry.url).to.match(/\battachments\.DocumentReference\b/)
                expect(entry.count).to.equal(2)
            })

        await request(SERVER.baseUrl)
            .post(`/admin/jobs/${jobId}/remove-files`)
            .set('Cookie', ['sid=TEST_SID'])
            .send({ params: [res.body.attachments[0].title] })
            .expect(200)
            .expect(res => {
                const { output } = res.body.manifest
                expect(output).to.be.instanceOf(Array)
                expect(output.length).to.equal(6)
                const entry = output.find((x: any) => x.type === "DocumentReference")
                expect(entry).to.exist
                expect(entry.url).to.match(/\battachments\.DocumentReference\b/)
                expect(entry.count).to.equal(1)
            })
    });
})

describe("Parallel tasks", function() {
    
    this.timeout(10_000)

    const cnt = 50
    const client = new EHIClient()
    let results: any[] = []

    it (`Create ${cnt} parallel exports`, async () => {
        const arr = []
        for (let i = cnt; i >= 0; i--) {
            arr.push(client.kickOff(PATIENT_ID))
        }
        results = await Promise.all(arr)
    })

    it (`Customize ${cnt} parallel exports`, async () => {
        await Promise.all(results.map(r => client.customize(r.jobId)));
    })

    it (`Wait for ${cnt} parallel exports`, async () => {
        await Promise.all(results.map(r => client.waitForStatus(r.jobId, "retrieved")));
    })

    it (`Approve ${cnt} parallel exports`, async () => {
        await Promise.all(results.map(r => client.approve(r.jobId)));
    })

    it (`Get the manifest of ${cnt} parallel exports`, async () => {
        await Promise.all(results.map(r => client.waitForExport(r.status)));
    })

})
