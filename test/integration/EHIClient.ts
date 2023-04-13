import { wait } from "../../lib"
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
        const res = await this.request(`${SERVER.baseUrl}/fhir/Patient/${patientId}/$ehi-export`, { method: "POST" });
        const status = res.headers.get('content-location')
        const jobId = status!.match(/\/jobs\/([^/]+)\/status/)?.[1]!
        return {
            link: res.headers.get('link'),
            response: res,
            status,
            jobId
        }
    }

    public async update(
        jobId: string,
        payload: {
            action: "addAttachments" | "removeAttachments" | "approve" | "reject" | "customize",
            [key: string]: any
        }
    ): Promise<Response>
    {
        return this.request(`${SERVER.baseUrl}/jobs/${jobId}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload)
        });
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
        return this.update(jobId, { action: "customize", payload });
    }

    public async approve(jobId: string): Promise<Response>
    {
        return this.update(jobId, { action: "approve" });
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
}
