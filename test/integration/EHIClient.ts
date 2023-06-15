import { expect }            from "chai"
import { wait }              from "../../lib"
import { authorize, SERVER } from "./TestContext"


export default class EHIClient
{
    private access_token: string | null = null

    public async getAccessToken() {
        if (this.access_token === null) {
            this.access_token = await authorize({ redirect_uri: SERVER.baseUrl })
        }
        return this.access_token
    }

    public async request(url: string, options: RequestInit = {}) {
        options.headers = {
            ...options.headers,
            authorization : "Bearer " + await this.getAccessToken()
        }
        return fetch(url, options)
    }

    public async kickOff(patientId: string) {
        const url = `${SERVER.baseUrl}/fhir/Patient/${patientId}/$ehi-export`
        const res = await this.request(url, { method: "POST" });
        expect(res.status, `kickOff failed for ${url}`).to.equal(202)
        const status = res.headers.get('content-location')
        expect(status).to.exist
        const jobId = status!.match(/\/jobs\/([^/]+)\/status/)?.[1]!
        expect(jobId).to.exist
        return {
            link: res.headers.get('link'),
            response: res,
            status,
            jobId
        }
    }

    public async customize(
        jobId: string,
        payload: {
            parameters    ?: EHI.ExportJobInformationParameters,
            authorizations?: EHI.ExportJobAuthorizations
        } = {
            parameters    : { labs: { name: "Labs", enabled: true } },
            authorizations: { hiv : { name: "HIV" , value  : true } }
        }
    ): Promise<Response>
    {
        return this.request(`${SERVER.baseUrl}/jobs/${jobId}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload)
        });
    }

    public async waitForExport(statusLocation: string): Promise<EHI.ExportManifest> {
        const res = await this.request(statusLocation);

        if (res.status >= 400) {
            throw new Error((await res.text()) || res.statusText)
        }

        if (res.status === 202) {
            await wait(1000)
            return await this.waitForExport(statusLocation)
        }

        return await res.json()
    }

    public async abort(jobId: string) {
        return this.request(`${SERVER.baseUrl}/jobs/${jobId}/status`, { method: "DELETE" })
    }

    public async getMetadata(jobId: string) {
        return this.request(`${SERVER.baseUrl}/jobs/${jobId}/metadata`)
    }
}
