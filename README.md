# ehi-server
This is an EHI Export Server POC implementation based on https://build.fhir.org/ig/argonautproject/ehi-api/ehi-export.html. The server supports the following routes:

**EHI Export**

|        |                                   |                                   |
|-------:|-----------------------------------|-----------------------------------|
|`POST`  | `/fhir/Patient/:id/$ehi-export`   | kick-off EHI export               |
|`GET`   | `/jobs/:id/customize`             | render job customization form     |
|`POST`  | `/jobs/:id`                       | customize and start job           |
|`GET`   | `/jobs/:id/status`                | get job status                    |
|`DELETE`| `/jobs/:id/status`                | abort/delete job                  |
|`GET`   | `/jobs/:id/download/:resourceType`| download resource file            |
|`GET`   | `/jobs/:id/metadata`              | get job info ***(proprietary)***  |


**SMART & FHIR**

|      |                                       |                                 |
|-----:|---------------------------------------|---------------------------------|
|`GET` |`/auth/authorize`                      | Starts the authorization flow   |
|`POST`|`/auth/token`                          | Get access or refresh token     |
|`GET` |`/authorize-app`                       | Renders the authorize app dialog|
|`GET` |`/patient-login`                       | Renders the patient login dialog|
|`GET` |`/fhir/.well-known/smart-configuration`| WellKnown SMART Configuration   |
|`GET` |`/fhir/metadata`                       | FHIR CapabilityStatement        |



## EHI Export Flow for Clients
----

1. Kick-off
   ```http
   POST /fhir/Patient/:id/$ehi-export
   authorization: Bearer ...
   content-type: application/json
   ```
2. Inspect kick-off response headers
   - `Content-Location` - sent if the export has been started
   - `Link` - sent if the export requires further customization
3. If `Link` header is sent, redirect the user there to customize and start the export
4. Wait! Pooling can be used to check periodically at `/jobs/:id/status`.
   - If the response status code is `202` schedule another check for later and exit
   - If the response status code is `200` the export is complete. Save the response manifest and proceed to #5.
   - Any other response status code - print an error and exit
5. Download the NDJSON files listed in the manifest. You only have a limited amount of time to do so before they expire.
6. Optionally send a DELETE request to the status endpoint to let the server know that the exported data can be deleted



## Proprietary Additions
----
There are several things that we had to add in our implementation to improve usability. The EHI Export specification is in it's early proposal stage. We assume that some of these additions may
be standardized later. They are listed here for clarity.
- `GET /jobs/:id/metadata` - While the proposed API is good enough to make EHI exports, client
   apps may want to show more info about the export job. For example, the administrator might want
   to see the options chosen py the patient in the customization form in order to decide if some
   files need to bedded before the export is approved. To enable this we include a `/jobs/:id/metadata` as well as a link to it in the manifest extensions.
- To make the `kick-off` endpoint callable from web apps we have to use CORS. This will hide most
   response headers from clients, unless otherwise specified. For that reason we had to add
   `Access-Control-Expose-Headers: Link, Content-Location` to our response headers. For more info
   see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Expose-Headers


