import { expect } from "chai";
import "mocha"
import { AddressInfo, Server } from "net"
import server                  from "../../app"


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

before(async () => { await SERVER.start() });

after(async () => { await SERVER.stop() });

export async function authorize({
    patient   = "0b8a6ef0-07c8-48ca-804d-1e64f6e44b95",
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
