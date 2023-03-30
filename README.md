# ehi-server


## Kick-off - `POST /fhir/Patient/:id/$ehi-export`
---
Starts new export job.
#### Request
- Headers
  - `authorization` - Requires valid bearer token
  - `content-type` - expects (but does not require) json mime type. If Parameters
    resource is not provided replies with `Link` response header which the client
    should follow.
- Body
  - JSON FHIR Parameters resource
  - None - we should then follow the `Link` header to build those Parameters
#### Response
- Status
  - `202 Accepted` - if the export has been started
  - `200 OK`       - If we require further params
  - `4XX or 5XX`   - in case of error
- Headers
  - `Content-Location` - sent if the export has been started
  - `Link` - sent if the export requires further customization
- Body
  - JSON FHIR OperationOutcome - required in case of error and optional otherwise 



## Customize Export - `GET /fhir/Patient/:id/$ehi-export/customize`
---
Render HTML form to customize a kick-off request. When the form is submitted it
builds a `Parameters` resource and sends it via new POST request to the kick-off
endpoint.

## Status - `GET /jobs/:id/status`
---
Get job status
#### Request
- Headers
  - `authorization` - Requires valid bearer token
#### Response
- Status
  - `200 OK` - If the export is ready
  - `202 Accepted` - while the export is in progress
  - `4XX or 5XX` - in case of error
- Body
  - JSON FHIR OperationOutcome - required in case of error and optional otherwise 


## Abort - `DELETE /jobs/:id/status`
---
Abort/delete job
#### Request
- Headers
  - `authorization` - Requires valid bearer token
#### Response
- Status
  - `202 Accepted` - if the job was found and removed
  - `4XX or 5XX` - in case of error
- Body
  - JSON FHIR OperationOutcome - required in case of error and optional otherwise 

## Download File - `GET /jobs/:id/download/:resourceType`
---
Download a file

## List Jobs - `GET /jobs` (**for admins**)
---
- Returns a list of all the export jobs currently available on the server. The
actual shape of the returned JSON object will be determined later.
#### Response
- Status
  - `200` OK` - if the request is OK and even of we don't have any jobs at the moment
  - `4XX or 5XX` - in case of error
- Headers
  - `Content-type`: `application/json`
- Body
  - JSON TBD


## View Job - `GET /jobs/:id` (**for admins**)
---
- Returns information about the export job specified by the `id` URL parameter
#### Response
- Status
  - `200` OK` - if the job is found
  - `4XX or 5XX` - in case of error
- Headers
  - `Content-type`: `application/json`
- Body
  - JSON TBD

## Update job - `POST /jobs/:id` (**for admins**)
---
Update job (approve, reject, add files...)

<br/>
<br/>
<br/>

## Questions
1. The export customization form is "owned" by the server. Every provider may have different parameters, thus will provide a different form. That form is the same for every client. That said,
the form can catch it's submit event, build a `Parameters` resource and POST it to the kick-off endpoint to start the request. However, the kick-off endpoint will require valid access token which is owned/provided by the client. QUESTION: should we consider standard way to pass this access token?
2. Can the customization form location be under the kick-off path (for example `{kick-off path}/`)? This way the form can simply submit to `../`. Otherwise the `Link` header that is returned by the kick-off call may have to include some kind of query parameter to tell the form where to submit to. Note that all this might be irrelevant if we can assume that the kick-off URL is well-known, fixed and can be hardcoded in the form action attribute.
3. The Kickoff endpoint should be callable from client apps which leads to the following:
  - CORS must be supported
  - `Access-Control-Expose-Headers: Link, Content-Location` response header must be set. See https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Expose-Headers
