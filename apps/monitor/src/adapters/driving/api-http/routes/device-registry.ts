import type { FastifyInstance } from 'fastify';
import type { DeviceRegistration } from '../../../../core/domain/device.ts';
import type { DeviceRegistry } from '../../../../core/ports/driving/device-registry.ts';
import { clientGoneSignal } from '../client-gone-signal.ts';
import { apiError, deviceIdParams, sendFailure } from '../responses.ts';

type DeviceIdParams = Pick<DeviceRegistration, 'deviceId'>;

const registerDeviceRegistryRoutes = (instance: FastifyInstance, deviceRegistry: DeviceRegistry) => {
  instance.get(
    '/devices',
    { schema: { response: { 200: { $ref: 'list-devices-result.schema.json#' }, 503: apiError } } },
    async (_request, reply) => {
      const result = await deviceRegistry.listDevices({}, { signal: clientGoneSignal(reply) });
      return result.ok ? reply.send({ data: result.value }) : sendFailure(reply, result.failure);
    },
  );

  instance.get<{ Params: DeviceIdParams }>(
    '/devices/:deviceId',
    {
      schema: {
        params: deviceIdParams,
        response: { 200: { $ref: 'get-device-result.schema.json#' }, 400: apiError, 404: apiError, 503: apiError },
      },
    },
    async (request, reply) => {
      const { deviceId } = request.params;
      const result = await deviceRegistry.getDevice({ deviceId }, { signal: clientGoneSignal(reply) });
      return result.ok ? reply.send(result.value) : sendFailure(reply, result.failure);
    },
  );

  // The body schema guarantees the shape, so the body can be read as a DeviceRegistration.
  instance.post<{ Body: DeviceRegistration }>(
    '/devices',
    {
      schema: {
        body: { $ref: 'register-device-command.schema.json#' },
        response: { 201: { $ref: 'register-device-result.schema.json#' }, 400: apiError, 409: apiError, 503: apiError },
      },
    },
    async (request, reply) => {
      const registration = request.body;
      const result = await deviceRegistry.registerDevice({ registration }, { signal: clientGoneSignal(reply) });
      if (!result.ok) {
        return sendFailure(reply, result.failure);
      }

      // Under the path it was registered at, so the Location carries the API's version.
      const location = `${request.url.split('?', 1)[0]}/${encodeURIComponent(registration.deviceId)}`;
      return reply.code(201).header('location', location).send(registration);
    },
  );

  // The schemas guarantee the shapes, so together they can be read as a DeviceRegistration.
  instance.put<{ Params: DeviceIdParams; Body: Omit<DeviceRegistration, 'deviceId'> }>(
    '/devices/:deviceId',
    {
      schema: {
        params: deviceIdParams,
        body: { $ref: 'update-device-command.schema.json#' },
        response: { 200: { $ref: 'update-device-result.schema.json#' }, 400: apiError, 404: apiError, 503: apiError },
      },
    },
    async (request, reply) => {
      const registration = { ...request.body, deviceId: request.params.deviceId };
      const result = await deviceRegistry.updateDevice({ registration }, { signal: clientGoneSignal(reply) });
      return result.ok ? reply.send(registration) : sendFailure(reply, result.failure);
    },
  );

  instance.delete<{ Params: DeviceIdParams }>(
    '/devices/:deviceId',
    {
      schema: {
        params: deviceIdParams,
        response: { 204: { type: 'null' }, 400: apiError, 404: apiError, 503: apiError },
      },
    },
    async (request, reply) => {
      const { deviceId } = request.params;
      const result = await deviceRegistry.unregisterDevice({ deviceId }, { signal: clientGoneSignal(reply) });
      return result.ok ? reply.code(204).send() : sendFailure(reply, result.failure);
    },
  );
};

export { registerDeviceRegistryRoutes };
