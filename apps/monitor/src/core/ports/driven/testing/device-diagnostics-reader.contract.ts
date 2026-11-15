import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TestContext } from 'node:test';
import type { AuthProfile } from '../../../domain/device.ts';
import { lobby } from '../../../domain/testing/devices.ts';
import type { DeviceDiagnosticsReader, DiagnosticsReport } from '../device-diagnostics-reader.ts';

/** What a device reports, without the payload: its bytes are the protocol's to give. */
type Reported = Omit<DiagnosticsReport, 'payload'>;

type FakeDevice =
  | { behavior: 'answers'; reported: Reported }
  /** Answers only a call that sends this token, and refuses the credentials otherwise. */
  | { behavior: 'answers_with_token'; reported: Reported; token: string }
  | { behavior: 'answers_nonsense' }
  | { behavior: 'fails' }
  | { behavior: 'behind_failing_gateway' }
  | { behavior: 'fails_tls' }
  | { behavior: 'never_answers' }
  | { behavior: 'absent' };

/**
 * Must put a device that behaves as described at an address, and return a reader whose secrets are these, and the
 * base URL and port to reach its diagnostics at. Anything it starts must stop when the test ends.
 */
type ArrangeDevice = (
  t: TestContext,
  device: FakeDevice,
  secrets?: Record<string, string>,
) => Promise<{ reader: DeviceDiagnosticsReader; baseUrl: string; port: number }>;

const options = { signal: AbortSignal.timeout(5000) };

const reported: Reported = {
  hardware: { model: 'USW-Pro-24', revision: 'r3', serial: 'F4E2C6A1B9D0' },
  softwareVersion: '7.1.4',
  firmwareVersion: '7.1.4',
  reportedStatus: 'ok',
  reportedChecksum: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
};

const bearer: AuthProfile = { strategy: 'bearer', secretRef: 'DEVICE_LOBBY_TOKEN' };

type ProtocolReasons = { fails: string; behindFailingGateway: string };

const testDeviceDiagnosticsReaderContract = (
  adapterName: string,
  arrangeDevice: ArrangeDevice,
  reasons: ProtocolReasons,
) => {
  const readFrom = async (t: TestContext, device: FakeDevice, auth: AuthProfile = lobby.auth, secrets = {}) => {
    const { reader, baseUrl, port } = await arrangeDevice(t, device, secrets);
    const result = await reader.readDiagnostics({ registration: { ...lobby, baseUrl, auth }, port }, options);
    return { result, protocol: reader.protocol };
  };

  describe(`DeviceDiagnosticsReader contract: ${adapterName}`, () => {
    it('returns what the device reports, and the bytes its checksum covers', async (t) => {
      // Act
      const { result } = await readFrom(t, { behavior: 'answers', reported });

      // Assert
      assert.ok(result.ok);
      const { payload, ...report } = result.value;
      assert.deepEqual(report, reported);
      assert.ok(payload instanceof Uint8Array && payload.length > 0);
    });

    it('sends the token its secretRef names', async (t) => {
      // Act
      const { result } = await readFrom(
        t,
        { behavior: 'answers_with_token', reported, token: 'lobby-secret' },
        bearer,
        {
          DEVICE_LOBBY_TOKEN: 'lobby-secret',
        },
      );

      // Assert
      assert.ok(result.ok);
    });

    const failures: [string, FakeDevice, string][] = [
      [
        'auth_failed when the device refuses the credentials',
        { behavior: 'answers_with_token', reported, token: 'lobby-secret' },
        'auth_failed',
      ],
      [
        'not_a_device_answer for an answer that is not diagnostics',
        { behavior: 'answers_nonsense' },
        'not_a_device_answer',
      ],
      [`${reasons.fails} when the device fails`, { behavior: 'fails' }, reasons.fails],
      [
        `${reasons.behindFailingGateway} when a gateway answers for the device`,
        { behavior: 'behind_failing_gateway' },
        reasons.behindFailingGateway,
      ],
    ];
    for (const [name, device, reason] of failures) {
      it(`reports ${name}, with the protocol and its status`, async (t) => {
        // Act
        const { result, protocol } = await readFrom(t, device, bearer, { DEVICE_LOBBY_TOKEN: 'wrong-secret' });

        // Assert
        assert.ok(!result.ok);
        assert.partialDeepStrictEqual(result.failure, { protocol, reason });
        assert.ok('httpStatus' in result.failure || 'grpcStatus' in result.failure);
      });
    }

    const noAnswers: [string, FakeDevice, string][] = [
      ['tls_failed when the TLS handshake fails', { behavior: 'fails_tls' }, 'tls_failed'],
      ['unreachable when no device is at the address', { behavior: 'absent' }, 'unreachable'],
    ];
    for (const [name, device, reason] of noAnswers) {
      it(`reports ${name}, with the protocol`, async (t) => {
        // Act
        const { result, protocol } = await readFrom(t, device);

        // Assert
        assert.ok(!result.ok);
        assert.partialDeepStrictEqual(result.failure, { protocol, reason });
      });
    }

    it('reports timeout when the signal ends the call, whatever its reason', async (t) => {
      // Arrange
      const { reader, baseUrl, port } = await arrangeDevice(t, { behavior: 'never_answers' });
      const caller = new AbortController();
      setTimeout(() => caller.abort(new Error('round stopped')), 20);

      // Act
      const result = await reader.readDiagnostics(
        { registration: { ...lobby, baseUrl }, port },
        { signal: caller.signal },
      );

      // Assert
      assert.ok(!result.ok);
      assert.partialDeepStrictEqual(result.failure, { protocol: reader.protocol, reason: 'timeout' });
    });
  });
};

export { testDeviceDiagnosticsReaderContract };
export type { ArrangeDevice, FakeDevice, ProtocolReasons, Reported };
