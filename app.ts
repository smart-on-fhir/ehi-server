import express, { NextFunction, Request, Response, urlencoded, json } from "express"
import cors                    from "cors"
import { AddressInfo }         from "net"
import multer                  from "multer"
import config                  from "./config"
import { HttpError }           from "./lib/errors"
import patients                from "./data/db"
import * as Gateway            from "./lib/EHIGateway"
import AuthorizeHandler        from "./lib/authorize"
import TokenHandler            from "./lib/token"
import getMetadata             from "./lib/metadata"
import getWellKnownSmartConfig from "./lib/smart-configuration"
import { asyncRouteWrap, getRequestBaseURL, validateToken } from "./lib"



const app = express()

const upload = multer({
    dest: "uploads/",
    limits: {
        files: 20,
        fileSize: 1024 * 1024 * 10 // 10MB
    }
})

app.use(cors({ origin: true, credentials: true }))
app.set('view engine', 'pug');
app.set('views', "./views");
app.use(express.static("./static"));
app.use(urlencoded({ extended: false, limit: "64kb" }));
app.use(json());

const requireAuth = validateToken()


// SMART: get authorization code
app.get("/auth/authorize", asyncRouteWrap(AuthorizeHandler.handle))

// SMART: get access or refresh token
app.post("/auth/token", asyncRouteWrap(TokenHandler.handle))

// SMART: authorize app dialog
app.get("/authorize-app", (req, res) => res.render("authorize-app", { query: req.query }))

// SMART: patient login dialog
app.get("/patient-login", (req, res) => {
    const list: any[] = [];
    patients.forEach((value, key) => {
        list.push({ id: key, name: value.patient.name, birthDate: value.patient.birthDate })
    })
    res.render("patient-login", { patients: list, query: req.query })
})

// SMART: WellKnown SMART Configuration
app.get("/fhir/.well-known/smart-configuration", getWellKnownSmartConfig)

// FHIR: CapabilityStatement
app.get("/fhir/metadata", asyncRouteWrap(getMetadata))

// EHI: kick-off
app.post("/fhir/Patient/:id/\\$ehi-export", requireAuth, asyncRouteWrap(Gateway.kickOff))

// EHI: Render job customization form
app.get("/jobs/:id/customize", asyncRouteWrap(Gateway.renderForm))

// EHI: get job status
app.get("/jobs/:id/status", requireAuth, asyncRouteWrap(Gateway.checkStatus))

// EHI: abort/delete job
app.delete("/jobs/:id/status", requireAuth, asyncRouteWrap(Gateway.abort))

// EHI: download resource file
app.get("/jobs/:id/download/:resourceType", requireAuth, asyncRouteWrap(Gateway.downloadFile))

// EHI: download attachment file
app.get("/jobs/:id/download/attachments/:file", requireAuth, asyncRouteWrap(Gateway.downloadAttachment))

// API: browse jobs
app.get("/jobs", asyncRouteWrap(Gateway.listJobs))

// API: view job
app.get("/jobs/:id", asyncRouteWrap(Gateway.viewJob))

// API: update job
app.post("/jobs/:id", upload.array("attachments", 10), asyncRouteWrap(Gateway.updateJob))

// Home page
app.get("/", (req, res) => res.render("index", { baseUrl: getRequestBaseURL(req) }))

// Global error handler
app.use((error: any, req: Request, res: Response, next: NextFunction) => {   
    if (error instanceof HttpError) {
        return error.render(req, res)
    } 
    /* istanbul ignore next */
    console.error(error);
    /* istanbul ignore next */
    res.status(error.code || 500).json({ error: error.message || 'Internal Server Error' });
})

// istanbul ignore next - Only start is not imported imported
if (require.main?.filename === __filename) {
    const server = app.listen(+config.port, config.host, () => {
        const address = server.address() as AddressInfo
        console.log(`Server available at http://${address.address}:${address.port}`)
    });
}

export default app