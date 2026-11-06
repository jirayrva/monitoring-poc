import { diagnosticsSchema } from '@device-monitor/contracts/device-api';
import { Ajv } from 'ajv';

type DiagnosticsAnswer = {
  hardware: { model: string; revision: string; serial: string };
  softwareVersion: string;
  firmwareVersion: string;
  status: string;
};

const isDiagnosticsAnswer = new Ajv({ strict: true }).compile<DiagnosticsAnswer>(diagnosticsSchema);

/**
 * The report in a diagnostics answer, whichever protocol carried it, or undefined when it is not one. Fields the schema
 * does not know go no further. The payload is exactly the bytes the checksum covers (Q-06).
 */
const toDiagnosticsReport = (document: unknown, reportedChecksum: string, payload: Uint8Array) => {
  if (!isDiagnosticsAnswer(document) || reportedChecksum === '') {
    return undefined;
  }

  const { hardware, softwareVersion, firmwareVersion, status } = document;
  const { model, revision, serial } = hardware;
  return {
    hardware: { model, revision, serial },
    softwareVersion,
    firmwareVersion,
    reportedStatus: status,
    reportedChecksum,
    payload,
  };
};

export { toDiagnosticsReport };
