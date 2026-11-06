import type { FastifyInstance } from 'fastify';
import type { DeviceRegistration } from '../../../../core/domain/device.ts';
import type { DeviceRegistry } from '../../../../core/ports/driving/device-registry.ts';
import { clientGoneSignal } from '../client-gone-signal.ts';
import { apiError, deviceIdParams, sendFailure } from '../responses.ts';

type DeviceIdParams = Pick<DeviceRegistration, 'deviceId'>;

const registerDeviceRegistryRoutes = (instance: FastifyInstance, deviceRegistry: DeviceRegistry) => {
  instance.get(
    '/devices',
    {
      schema: {
        operationId: 'listDevices',
        summary: 'List devices',
        description: 'Returns every registered device, and how to reach it, ordered by device ID.',
        response: { 200: { $ref: 'list-devices-result.schema.json#' }, 503: apiError },
      },
    },
    async (_request, reply) => {
      const result = await deviceRegistry.listDevices({}, { signal: clientGoneSignal(reply) });
      return result.ok ? reply.send({ data: result.value }) : sendFailure(reply, result.failure);
    },
  );

  instance.get<{ Params: DeviceIdParams }>(
    '/devices/:deviceId',
    {
      schema: {
        operationId: 'getDevice',
        summary: 'Get a device',
        description: 'Returns one registered device, and how to reach it.',
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
        operationId: 'registerDevice',
        summary: 'Register a device',
        description: 'Starts monitoring a new device, and returns it with where to find it in the Location header.',
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
        operationId: 'updateDevice',
        summary: 'Update a device',
        description:
          "Replaces a device's name, base URL and auth, and returns the updated device. Its ID can't change.",
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
        operationId: 'unregisterDevice',
        summary: 'Unregister a device',
        description: 'Stops monitoring a device. Its history stays, and its ID can be registered again.',
        params: deviceIdParams,
        response: {
          204: { type: 'null', description: 'The device was unregistered.' },
          400: apiError,
          404: apiError,
          503: apiError,
        },
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
