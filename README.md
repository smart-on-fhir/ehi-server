# ehi-server
This is an EHI Export Server POC implementation based on https://build.fhir.org/ig/argonautproject/ehi-api/ehi-export.html.

---
- **[Try the EHI Export Demo App](https://ehi-app.herokuapp.com/)**
---


The server supports the following routes:

**EHI Export**

|        |                                                      |                                                                                       |
|-------:|------------------------------------------------------|---------------------------------------------------------------------------------------|
|`POST`  | `/fhir/Patient/:id/$ehi-export`                      | kick-off EHI export                                                                   |
|`POST`  | `/auto-approve/fhir/Patient/:id/$ehi-export`         | kick-off EHI export that does not require admin approval                              |
|`POST`  | `/no-form/fhir/Patient/:id/$ehi-export`              | kick-off EHI export that does not have a customization form                           |
|`POST`  | `/no-form/auto-approve/fhir/Patient/:id/$ehi-export` | kick-off EHI export that does not require admin approval or have a customization form |
|`POST`  | `/auto-approve/no-form/fhir/Patient/:id/$ehi-export` | kick-off EHI export that does not require admin approval or have a customization form |
|`GET`   | `/jobs/:id/customize`                                | render job customization form                                                         |
|`POST`  | `/jobs/:id`                                          | customize and start job                                                               |
|`GET`   | `/jobs/:id/status`                                   | get job status                                                                        |
|`DELETE`| `/jobs/:id/status`                                   | abort/delete job                                                                      |
|`GET`   | `/jobs/:id/download/:file`                           | download resource file                                                                |
|`GET`   | `/jobs/:id/download/attachments/:file`               | download attachment file                                                              |


**SMART & FHIR**

|      |                                       |                                 |
|-----:|---------------------------------------|---------------------------------|
|`GET` |`/auth/authorize`                      | Starts the authorization flow   |
|`POST`|`/auth/token`                          | Get access or refresh token     |
|`GET` |`/authorize-app`                       | Renders the authorize app dialog|
|`GET` |`/patient-login`                       | Renders the patient login dialog|
|`GET` |`/fhir/.well-known/smart-configuration`| WellKnown SMART Configuration   |
|`GET` |`/fhir/metadata`                       | FHIR CapabilityStatement        |


**Export Administration API (proprietary)**

|        |                              |                              |
|-------:|------------------------------|------------------------------|
|`POST`  |`/admin/login`                | login                        |
|`GET`   |`/admin/logout`               | logout                       |
|`GET`   |`/admin/jobs`                 | Get all jobs                 |
|`GET`   |`/admin/jobs/:id`             | Get job by id                |
|`POST`  |`/admin/jobs/:id/approve`     | Approve a pending export job |
|`POST`  |`/admin/jobs/:id/reject`      | Reject a pending export job  |
|`POST`  |`/admin/jobs/:id/add-files`   | Upload file attachments      |
|`POST`  |`/admin/jobs/:id/remove-files`| Remove file attachments      |
|`DELETE`|`/admin/jobs/:id`             | Delete job by id             |



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
- To make the `kick-off` endpoint callable from web apps we have to use CORS. This will hide most
   response headers from clients, unless otherwise specified. For that reason we had to add
   `Access-Control-Expose-Headers: Link, Content-Location` to our response headers. For more info
   see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Expose-Headers
- There are custom kick-off endpoints (listed above) that allow an export to be started without
  requiring an admin approval or a customization form. This was done to help developers who are
  creating their own client apps and want to test them with this server.
  

