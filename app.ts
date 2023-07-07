import express, { NextFunction, Request, Response, urlencoded, json } from "express"
import cors                    from "cors"
import { AddressInfo }         from "net"
import multer                  from "multer"
import cookieParser            from "cookie-parser"
import config                  from "./config"
import AuthorizeHandler        from "./lib/authorize"
import TokenHandler            from "./lib/token"
import getMetadata             from "./lib/metadata"
import patients                from "./data/db"
import getWellKnownSmartConfig from "./lib/smart-configuration"
import * as Gateway            from "./lib/EHIGateway"
import { HttpError }           from "./lib/errors"
import { start }               from "./lib/ExportJobManager"
import {
    asyncRouteWrap as wrap,
    login,
    logout,
    requireAdminAuth,
    validateToken
} from "./lib"


const app = express()


app.use(cors({ origin: true, credentials: true }))
app.set('view engine', 'pug');
app.set('views', "./views");
app.use(express.static("./static"));
app.use(cookieParser())
app.use(urlencoded({ extended: false, limit: "64kb" }));
app.use(json());
const upload = multer({
    dest: "backend/uploads/",
    limits: {
        files: 5,
        fileSize: 1024 * 1024 * 10 // 10MB
    }
})
const requireSmartAuth = validateToken()

const requireAuth = validateToken()


// -----------------------------------------------------------------------------
//                                SMART & FHIR
// -----------------------------------------------------------------------------

// get authorization code
app.get("/auth/authorize", wrap(AuthorizeHandler.handle))

// get access or refresh token
app.post("/auth/token", wrap(TokenHandler.handle))

// authorize app dialog
app.get("/authorize-app", (req, res) => res.render("authorize-app", { query: req.query }))

// patient login dialog
app.get("/patient-login", (req, res) => {
    const list: any[] = [];
    patients.forEach((value, key) => {
        list.push({ id: key, name: value.patient.name, birthDate: value.patient.birthDate })
    })
    res.render("patient-login", { patients: list, query: req.query })
})

// WellKnown SMART Configuration
app.get("/fhir/.well-known/smart-configuration", getWellKnownSmartConfig)

// FHIR CapabilityStatement
app.get("/fhir/metadata", wrap(getMetadata))

// -----------------------------------------------------------------------------
//                                 EHI Export
// -----------------------------------------------------------------------------

// kick-off
app.post("/fhir/Patient/:id/\\$ehi-export", requireSmartAuth, wrap(Gateway.kickOff))

// get job status
app.get("/jobs/:id/status", requireSmartAuth, wrap(Gateway.checkStatus))

// abort/delete job (bulk data like)
app.delete("/jobs/:id/status", requireSmartAuth, wrap(Gateway.abort))

// Render job customization form
app.get("/jobs/:id/customize", wrap(Gateway.renderForm))

// download resource file
app.get("/jobs/:id/download/:resourceType", requireSmartAuth, wrap(Gateway.downloadFile))

// customize and start job
app.post("/jobs/:id", wrap(Gateway.customizeAndStart))


// -----------------------------------------------------------------------------
//                                 ADMIN API
// -----------------------------------------------------------------------------
app.post("/admin/login", wrap(login))
app.get("/admin/logout", requireAdminAuth, wrap(logout))
app.get("/admin/jobs/:id", requireAdminAuth, wrap(Gateway.getJob))
app.post("/admin/jobs/:id/approve", requireAdminAuth, wrap(Gateway.approveJob))
app.post("/admin/jobs/:id/reject", requireAdminAuth, wrap(Gateway.rejectJob))

// Other -----------------------------------------------------------------------

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

start()

// istanbul ignore next - Only start is not imported imported
if (require.main?.filename === __filename) {
    const server = app.listen(+config.port, config.host, () => {
        const address = server.address() as AddressInfo
        console.log(`Server available at http://${address.address}:${address.port}`)
    });
}

export default app