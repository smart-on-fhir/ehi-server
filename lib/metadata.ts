import { Request, Response } from "express"
import { getRequestBaseURL } from "."
import pkg                   from "../package.json"


const SERVER_START_TIME = new Date().toISOString();

const SUPPORTED_FORMATS = [
    "application/fhir+json",
    "application/json+fhir",
    "application/json",
    "text/json",
    "json"
];

const SUPPORTED_ACCEPT_MIME_TYPES = [
    "application/fhir+json",
    "application/json+fhir",
    "application/json",
    "text/json",
    "text/html", // for browsers
    "json",
    "*/*"
];

function getCapabilityStatement(req: Request)
{
    const baseUrl = getRequestBaseURL(req)

    return {
        resourceType: "CapabilityStatement",
        status      : "active",
        date        : SERVER_START_TIME,
        publisher   : "Boston Children's Hospital",
        kind        : "instance",
        instantiates: [
            "http://hl7.org/fhir/uv/bulkdata/CapabilityStatement/bulk-data"
        ],
        software: {
            name: "SMART Sample Bulk Data Server",
            version: pkg.version
        },
        implementation: {
            "description": "SMART Sample Bulk Data Server"
        },
        fhirVersion  : "4.0.1",
        acceptUnknown: "extensions",
        format       : [ "json" ],
        rest: [
            {
                mode: "server",
                security: {
                    extension: [
                        {
                            url: "http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris",
                            extension: [
                                { url: "authorize", valueUri: `${baseUrl}/auth/authorize` },
                                { url: "token"    , valueUri: `${baseUrl}/auth/token`     },
                            ]
                        }
                    ],
                    service: [
                        {
                            coding: [
                                {
                                    system : "http://hl7.org/fhir/restful-security-service",
                                    code   : "SMART-on-FHIR",
                                    display: "SMART-on-FHIR"
                                }
                            ],
                            text: "OAuth2 using SMART-on-FHIR profile (see http://docs.smarthealthit.org)"
                        }
                    ]
                },
                resource: getResources(),
                operation: getOperations()
            }
        ]
    }
}

function getResources() {
    return [
        {
            "type": "Patient",
            "operation": [
                {
                    "extension": [
                        {
                            "url": "http://hl7.org/fhir/StructureDefinition/capabilitystatement-expectation",
                            "valueCode": "SHOULD"
                        }
                    ],
                    "name": "patient-export",
                    "definition": "http://hl7.org/fhir/uv/bulkdata/OperationDefinition/patient-export"
                }
            ]
        },
        {
            "type": "Group",
            "operation": [
                {
                    "extension": [
                        {
                            "url": "http://hl7.org/fhir/StructureDefinition/capabilitystatement-expectation",
                            "valueCode": "SHOULD"
                        }
                    ],
                    "name": "group-export",
                    "definition": "http://hl7.org/fhir/uv/bulkdata/OperationDefinition/group-export"
                }
            ]
        },
        {
            "type": "OperationDefinition",
            "profile": {
                "reference": "http://hl7.org/fhir/Profile/OperationDefinition"
            },
            "interaction": [
                {
                    "code": "read"
                }
            ],
            "searchParam": []
        }
    ]
}

function getOperations() {
    return [
        {
            "name": "get-resource-counts",
            "definition": "OperationDefinition/-s-get-resource-counts"
        },
        {
            "extension": [
              {
                "url": "http://hl7.org/fhir/StructureDefinition/capabilitystatement-expectation",
                "valueCode": "SHOULD"
              }
            ],
            "name": "export",
            "definition": "http://hl7.org/fhir/uv/bulkdata/OperationDefinition/export"
        }
    ];
}




export default function(req: Request, res: Response) {

    const _format = String(req.query._format || "");

    if (_format) {
        let format = _format.toLowerCase();
        if (!SUPPORTED_FORMATS.some(mime => format.indexOf(mime) === 0)) {
            return res.status(400).send(`Unsupported _format parameter "${_format}"`);
        }
    }

    const accept = String(req.headers.accept || "*/*").toLowerCase().split(/\s*[;,]\s*/).shift();
    if (!SUPPORTED_ACCEPT_MIME_TYPES.some(f => f === accept)) {
        return res.status(400).send(`Unsupported value "${accept}" in accept header`);
    }

    const statement = getCapabilityStatement(req);

    res.set("content-type", "application/fhir+json; charset=utf-8")
    res.send(JSON.stringify(statement, null, 4))
}
