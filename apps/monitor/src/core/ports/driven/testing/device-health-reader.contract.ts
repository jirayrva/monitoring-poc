import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TestContext } from 'node:test';
import type { AuthProfile } from '../../../domain/device.ts';
import { lobby } from '../../../domain/testing/devices.ts';
import type { DeviceHealthReader, HealthReport } from '../device-health-reader.ts';

type FakeDevice =
  | { behavior: 'answers'; report: HealthReport }
  /** Answers only a call that sends this token, and refuses the credentials otherwise. */
  | { behavior: 'answers_with_token'; report: HealthReport; token: string }
  | { behavior: 'answers_nonsense' }
  | { behavior: 'has_no_health' }
  | { behavior: 'fails' }
  | { behavior: 'behind_failing_gateway' }
  /** Fails the TLS handshake, as a device that speaks no TLS on an https base URL. */
  | { behavior: 'fails_tls' }
  | { behavior: 'never_answers' }
  | { behavior: 'absent' };

/**
 * Must put a device that behaves as described at an address, and return a reader whose secrets are these, and the
 * base URL to reach the device at. Anything it starts must stop when the test ends.
 */
type ArrangeDevice = (
  t: TestContext,
  device: FakeDevice,
  secrets?: Record<string, string>,
) => Promise<{ reader: DeviceHealthReader; baseUrl: string }>;

const options = { signal: AbortSignal.timeout(5000) };

const lobbyReport: HealthReport = {
  deviceId: lobby.deviceId,
  health: { state: 'ok' },
  capabilities: {
    deviceType: 'switch',
    protocols: [
      { name: 'grpc', version: '1', port: 50051 },
      { name: 'rest', version: '1', port: 443 },
    ],
    checksumAlgorithm: 'sha256',
  },
};

const bearer: AuthProfile = { strategy: 'bearer', secretRef: 'DEVICE_LOBBY_TOKEN' };

const testDeviceHealthReaderContract = (adapterName: string, arrangeDevice: ArrangeDevice) => {
  const readFrom = async (t: TestContext, device: FakeDevice, auth: AuthProfile = lobby.auth, secrets = {}) => {
    const { reader, baseUrl } = await arrangeDevice(t, device, secrets);
    return reader.readHealth({ registration: { ...lobby, baseUrl, auth } }, options);
  };

  describe(`DeviceHealthReader contract: ${adapterName}`, () => {
    it("returns the device's ID, health and capabilities, protocols in the device's order", async (t) => {
      // Act
      const result = await readFrom(t, { behavior: 'answers', report: lobbyReport });

      // Assert
      assert.deepEqual(result, { ok: true, value: lobbyReport });
    });

    it('returns the ID another device gives, for the probe to compare', async (t) => {
      // Arrange
      const report = { ...lobbyReport, deviceId: 'some-other-device' };

      // Act
      const result = await readFrom(t, { behavior: 'answers', report });

      // Assert
      assert.deepEqual(result, { ok: true, value: report });
    });

    it('keeps a health word it does not know, as the device said it', async (t) => {
      // Arrange
      const report: HealthReport = { ...lobbyReport, health: { state: 'unrecognized', reported: 'adopting' } };

      // Act
      const result = await readFrom(t, { behavior: 'answers', report });

      // Assert
      assert.deepEqual(result, { ok: true, value: report });
    });

    it('sends the token its secretRef names', async (t) => {
      // Arrange
      const device: FakeDevice = { behavior: 'answers_with_token', report: lobbyReport, token: 'lobby-secret' };

      // Act
      const result = await readFrom(t, device, bearer, { DEVICE_LOBBY_TOKEN: 'lobby-secret' });

      // Assert
      assert.deepEqual(result, { ok: true, value: lobbyReport });
    });

    it('reports token_missing, calling nothing, when the token its secretRef names is not set', async (t) => {
      // Act
      const result = await readFrom(t, { behavior: 'never_answers' }, bearer);

      // Assert
      assert.deepEqual(result, { ok: false, failure: { response: 'misconfigured', reason: 'token_missing' } });
    });

    const failures: [string, FakeDevice, object][] = [
      [
        'auth_failed when the device refuses the credentials',
        { behavior: 'answers_with_token', report: lobbyReport, token: 'lobby-secret' },
        { response: 'misconfigured', reason: 'auth_failed' },
      ],
      [
        'not_found when the device has no health',
        { behavior: 'has_no_health' },
        { response: 'misconfigured', reason: 'not_found' },
      ],
      [
        'not_a_device_answer for an answer that is not health',
        { behavior: 'answers_nonsense' },
        { response: 'unexpected', reason: 'not_a_device_answer' },
      ],
      ['http_error when the device fails', { behavior: 'fails' }, { response: 'unexpected', reason: 'http_error' }],
      [
        'gateway_error when a gateway answers for the device',
        { behavior: 'behind_failing_gateway' },
        { response: 'none', reason: 'gateway_error' },
      ],
    ];
    for (const [name, device, failure] of failures) {
      it(`reports ${name}, with the HTTP status`, async (t) => {
        // Act
        const result = await readFrom(t, device, bearer, { DEVICE_LOBBY_TOKEN: 'wrong-secret' });

        // Assert
        assert.ok(!result.ok);
        assert.partialDeepStrictEqual(result.failure, failure);
        assert.ok('httpStatus' in result.failure);
      });
    }

    it('reports tls_failed when the TLS handshake fails', async (t) => {
      // Act
      const result = await readFrom(t, { behavior: 'fails_tls' });

      // Assert
      assert.deepEqual(result, { ok: false, failure: { response: 'misconfigured', reason: 'tls_failed' } });
    });

    it('reports unreachable when no device is at the address', async (t) => {
      // Act
      const result = await readFrom(t, { behavior: 'absent' });

      // Assert
      assert.deepEqual(result, { ok: false, failure: { response: 'none', reason: 'unreachable' } });
    });

    it('reports timeout when the signal ends the call, whatever its reason', async (t) => {
      // Arrange
      const { reader, baseUrl } = await arrangeDevice(t, { behavior: 'never_answers' });
      const caller = new AbortController();
      setTimeout(() => caller.abort(new Error('round stopped')), 20);

      // Act
      const result = await reader.readHealth({ registration: { ...lobby, baseUrl } }, { signal: caller.signal });

      // Assert
      assert.deepEqual(result, { ok: false, failure: { response: 'none', reason: 'timeout' } });
    });
  });
};

export { testDeviceHealthReaderContract };
export type { ArrangeDevice, FakeDevice };
