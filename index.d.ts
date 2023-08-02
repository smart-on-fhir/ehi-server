import { Request } from "express-serve-static-core";

/**
 * Type definitions for SMART
 */
declare namespace SMART {

    // For the purpose of this prototype we only support public and
    // confidential-symmetric clients
    type SMARTClientType = "public" | "confidential-symmetric"
    

    /**
     * Once an app is authorized, the token response will include any context
     * data the app requested and any (potentially) unsolicited context data the
     * EHR may decide to communicate. For example, EHRs may use launch context
     * to communicate UX and UI expectations to the app (need_patient_banner).
     */
    interface LaunchContext {

        /**
         * Boolean value indicating whether the app was launched in a UX context
         * where a patient banner is required (when true) or not required (when
         * false). An app receiving a value of false should not take up screen
         * real estate displaying a patient banner.
         */
        need_patient_banner?: boolean

        /**
         * String value with a patient id, indicating that the app was launched
         * in the context of FHIR Patient 123. If the app has any patient-level
         * scopes, they will be scoped to Patient 123.
         */
        patient?: string
        
        /**
         * String value with an encounter id, indicating that the app was
         * launched in the context of FHIR Encounter 123.
         */
        encounter?: string

        /**
         * String URL where the EHR’s style parameters can be retrieved (for
         * apps that support styling)
         */
        smart_style_url?: string

    }

    /**
     * The authorization token (for example the one that is represented as `code`
     * parameter in the code flow)
     */
    interface AuthorizationToken extends LaunchContext {
        context: LaunchContext,

        /**
         * The client_id of the app being launched
         */
        client_id: string

        /**
         * The scopes requested bu the app
         */
        scope: string

        /**
         * The code_challenge_method used by the app
         */
        code_challenge_method?: string

        /**
         * The code_challenge used by the app
         */
        code_challenge?: string
        
        redirect_uri: string

        /**
         * The selected user ID (if any)
         * @example `Patient/123` or `Practitioner/123`
         */
        user?: string

        client_type?: SMARTClientType

    }

    /**
     * The shape of the response of the token endpoint.
     */
    interface TokenResponse {
        
        token_type: "Bearer"

        access_token: string

        /**
         * Lifetime in seconds of the access token, after which the token SHALL
         * NOT be accepted by the resource server
         */
        expires_in?: number

        /**
         * Scope of access authorized. Note that this can be different from the
         * scopes requested by the app.
         */
        scope: string

        /**
         * Token that can be used to obtain a new access token, using the same
         * or a subset of the original authorization grants. If present, the
         * app should discard any previous refresh_token associated with this
         * launch and replace it with this new value.
         */
        refresh_token?: string
    }

    /**
     * The shape of the response of the token endpoint.
     */
    interface AccessTokenResponse extends TokenResponse, LaunchContext {
        
        /**
         * Authenticated user identity and user details, if requested
         */
        id_token?: string
    }
}

/**
 * Type definitions for EHI export
 */
declare namespace EHI {

    /**
     * The manifest returned by the EHI export status endpoint when the export
     * is complete. This is very similar to the Bulk Data export manifest.
     */
    interface ExportManifest {
        /**
         * Array of links to NDJSON files containing errors as OperationOutcomes 
         */
        error: ExportManifestErrorEntry[]
        
        /**
         * Array of links to NDJSON files containing FHIR resources 
         */
        output: ExportManifestFileEntry[]

        /**
         * When was this export started - FHIR instant
         */
        transactionTime: string

        /**
         * This will be true if the server requires the access token to be
         * included in file download requests
         */
        requiresAccessToken: boolean
    }

    /**
     * Link to NDJSON file containing errors as OperationOutcomes
     */
    interface ExportManifestErrorEntry {
        type: "OperationOutcome"
        url : string
    }

    /**
     * Link to NDJSON file containing FHIR resources of the given type
     */
    interface ExportManifestFileEntry {
        type  : string
        url   : string
        count?: number
    }

    /**
     * Can be:
     * 
     * - `awaiting-input`
     *    The user needs to fill in the form.
     * 
     * - `requested`
     *    After the export is approved by the admin and while the data is being
     *    exported.
     * 
     * - `retrieved`
     *    All the data transmitted to its destination. At this pont the jobs is
     *    waiting for the admin to approve it
     * 
     * - `approved`
     *    Admin approved this export and it is now visible to the patient
     * 
     * - `rejected`
     *    Admin rejected this export and it is scheduled to be deleted
     * 
     * **Note** that jobs have certain lifetime. Once they expire they will be
     * deleted within the next `config.jobCleanupMinutes` minutes:
     * 
     * - `awaiting-input` - Does not expire
     * - `requested`      - Expire after `config.jobMaxLifetimeMinutes`
     * - `retrieved`      - Expire after `config.jobMaxLifetimeMinutes`
     * - `approved`       - Expire after `config.completedJobLifetimeMinutes`
     * - `rejected`       - Expire immediately
     */
    type ExportJobStatus =  "awaiting-input" |
                            "requested" |
                            "retrieved" |
                            "approved"  |
                            "rejected";

    /**
     * The JSON representation of an export job
     */
    interface ExportJob {
        
        /**
         * Random 8 char hex job ID  
         */
        id: string

        /**
         * The ID and humanized name of the patient
         */
        patient: {
            id: string
            name: string
        }

        /**
         * The bulk data export manifest if available. This will be null until
         * the export is approved and started (until it enters "requested" state) 
         */
        manifest: ExportManifest | null

        /**
         * The job status
         */
        status: ExportJobStatus
        
        /**
         * The JS timestamp showing when this job was created
         */
        createdAt: number

        /**
         * The JS timestamp showing when this job was completed, or `0` if it
         * hasn't been completed yet
         */
        completedAt: number

        parameters?: ExportJobInformationParameters

        authorizations?: ExportJobAuthorizations

        attachments: fhir4.Attachment[]

        autoApprove: boolean
    }

    interface ExportJobInformationParameter {
        name   : string
        enabled: boolean
        notes ?: string
        from  ?: string | false
        to    ?: string | false
        group ?: number
    }

    interface ExportJobInformationParameters {
        medicalRecord   ?: ExportJobInformationParameter,
        visits          ?: ExportJobInformationParameter,
        dischargeSummary?: ExportJobInformationParameter,
        labs            ?: ExportJobInformationParameter,
        operative       ?: ExportJobInformationParameter,
        pathology       ?: ExportJobInformationParameter,
        radiation       ?: ExportJobInformationParameter,
        radiology       ?: ExportJobInformationParameter,
        photographs     ?: ExportJobInformationParameter,
        billing         ?: ExportJobInformationParameter,
        other           ?: ExportJobInformationParameter
    }

    interface ExportJobAuthorization {
        name : string
        value: boolean | string
    }

    interface ExportJobAuthorizations {
        hiv             ?: ExportJobAuthorization,
        alcoholAndDrug  ?: ExportJobAuthorization,
        mentalHealth    ?: ExportJobAuthorization,
        confidential    ?: ExportJobAuthorization,
        domesticViolence?: ExportJobAuthorization,
        sexualAssault   ?: ExportJobAuthorization,
        genetic         ?: ExportJobAuthorization,
        other           ?: ExportJobAuthorization
    }

    interface UserRequest extends Request {
        user?: User
    }

    interface AuthenticatedRequest extends Request {
        user: User
    }

    interface User {
        username: string
        password: string
    }

}

export as namespace SMART
export as namespace EHI
