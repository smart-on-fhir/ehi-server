import "mocha"
import path                    from "path"
import { readdir, rm }         from "fs/promises"
import { expect }              from "chai"
import { AddressInfo, Server } from "net"
import server                  from "../../app"
import patients                from "../../data/db"
import { SESSIONS }            from "../../lib"
import config                  from "../../config"


let testServer: Server | null

export const SERVER = {
    baseUrl: "",
    start() {
        return new Promise(resolve => {
            testServer = server.listen(0, "localhost", () => {
                const address = testServer!.address() as AddressInfo
                this.baseUrl = "http://localhost:" + address.port
                console.log(`Test server listening at ${this.baseUrl}`)
                resolve(this)
            })
        })
    },
    stop() {
        return new Promise((resolve, reject) => {
            if (testServer && testServer.listening) {
                testServer.close((error?: Error) => {
                    if (error) {
                        reject(error)
                    } else {
                        console.log(`Test server stopped`)
                        resolve(this)
                    }
                })
            } else {
                resolve(this)
            }
        })
    }
};

export const FIRST_PATIENT_ID = getFirstPatientId();

before(async () => { await SERVER.start() });

after(async () => {
    await SERVER.stop()
    await cleanupJobs()
    await cleanupUploads()
});

export async function cleanupJobs() {
    const base  = path.join(__dirname, "../../test-jobs")
    const items = await readdir(base, { withFileTypes: true });
    for (const entry of items) {
        if (entry.isDirectory()) {
            const dir = path.join(base, entry.name)
            await rm(dir, { force: true, recursive: true })
        }
    }
}

export async function cleanupUploads() {
    const base  = path.join(__dirname, "../../uploads")
    const items = await readdir(base, { withFileTypes: true });
    for (const entry of items) {
        if (entry.isFile() && entry.name !== ".gitkeep") {
            await rm(path.join(base, entry.name), { force: true })
        }
    }
}

export function getFirstPatientId() {
    for (const id of patients.keys()) {
        return id
    }
    throw new Error("No patients found")
}

export async function authorize({
    patient   = FIRST_PATIENT_ID,
    client_id = "test_client_id",
    scope     = "patient/$ehi-export",
    aud       = SERVER.baseUrl + "/fhir",
    state     = "state-id",
    redirect_uri
}: {
    patient  ?: string
    client_id?: string
    scope    ?: string
    aud      ?: string
    state    ?: string
    redirect_uri: string
})
{
    // 1. Get authorization code
    // -------------------------------------------------------------------------
    const authorizeUrl = new URL("/auth/authorize", SERVER.baseUrl)
    authorizeUrl.searchParams.set("response_type", "code"      )
    authorizeUrl.searchParams.set("client_id"    , client_id   )
    authorizeUrl.searchParams.set("scope"        , scope       )
    authorizeUrl.searchParams.set("aud"          , aud         )
    authorizeUrl.searchParams.set("redirect_uri" , redirect_uri)
    authorizeUrl.searchParams.set("state"        , state       )
    authorizeUrl.searchParams.set("_patient"     , patient     )
    authorizeUrl.searchParams.set("_auth_success", "1"         )
    const authorizeResponse = await fetch(authorizeUrl.href, { redirect: "manual" })
    expect(authorizeResponse.status).to.equal(302)
    const location = authorizeResponse.headers.get("location")
    expect(location, "location header not sent by the server").to.exist
    
    const url = new URL(location!)
    const authorizationCode = url.searchParams.get("code")
    if (!authorizationCode) {
        const error = url.searchParams.get("error")
        const error_description = url.searchParams.get("error_description")
        const msg = [error, error_description].filter(Boolean).join(": ") || `location header (${location}) did not include code parameter`
        throw new Error(msg)
    }

    // 2. Exchange authorization code for access token
    // -------------------------------------------------------------------------
    const payload = new URLSearchParams()
    payload.set("grant_type"  , "authorization_code")
    payload.set("code"        , authorizationCode!)
    payload.set("redirect_uri", redirect_uri)
    payload.set("client_id"   , client_id)
    const tokenResponse = await fetch(SERVER.baseUrl + "/auth/token", {
        method: "POST",
        body: payload,
        headers: { "content-type": "application/x-www-form-urlencoded" }
    })
    const tokenResponseJson = await tokenResponse.json()
    const access_token = await tokenResponseJson.access_token
    
    return access_token
}

export function login() {
    SESSIONS.push({
        sid: "TEST_SID",
        username: config.users[0].username,
        expires: Date.now() + 60000
    })
}
