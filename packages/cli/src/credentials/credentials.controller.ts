/* eslint-disable @typescript-eslint/no-shadow */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-restricted-syntax */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable import/no-cycle */
import express from 'express';
import { INodeCredentialTestResult, LoggerProxy } from 'n8n-workflow';
import { getLogger } from '../Logger';

import { GenericHelpers, ICredentialsResponse, ResponseHelper } from '..';

import type { CredentialRequest } from '../requests';
import * as config from '../../config';
import { CredentialsService } from './credentials.service';
import { EECredentialsController } from './credentials.controller.ee';

export const credentialsController = express.Router();

/**
 * Initialize Logger if needed
 */
credentialsController.use((req, res, next) => {
	try {
		LoggerProxy.getInstance();
	} catch (error) {
		LoggerProxy.init(getLogger());
	}
	next();
});

credentialsController.use('/', EECredentialsController);

/**
 * GET /credentials
 */
credentialsController.get(
	'/',
	ResponseHelper.send(async (req: CredentialRequest.GetAll): Promise<ICredentialsResponse[]> => {
		const filter = req.query.filter ? (JSON.parse(req.query.filter) as Record<string, string>) : {};

		const credentials = await CredentialsService.getFiltered(req.user, filter);

		return credentials.map((credential) => {
			// eslint-disable-next-line no-param-reassign
			credential.id = credential.id.toString();
			return credential as ICredentialsResponse;
		});
	}),
);

/**
 * GET /credentials/new
 *
 * Generate a unique credential name.
 */
credentialsController.get(
	'/new',
	ResponseHelper.send(async (req: CredentialRequest.NewName): Promise<{ name: string }> => {
		const { name: newName } = req.query;

		return {
			name: await GenericHelpers.generateUniqueName(
				newName ?? config.getEnv('credentials.defaultName'),
				'credentials',
			),
		};
	}),
);

/**
 * POST /credentials/test
 *
 * Test if a credential is valid.
 */
credentialsController.post(
	'/test',
	ResponseHelper.send(async (req: CredentialRequest.Test): Promise<INodeCredentialTestResult> => {
		const { credentials, nodeToTestWith } = req.body;

		const encryptionKey = await CredentialsService.getEncryptionKey();
		return CredentialsService.test(req.user, encryptionKey, credentials, nodeToTestWith);
	}),
);

/**
 * POST /credentials
 */
credentialsController.post(
	'/',
	ResponseHelper.send(async (req: CredentialRequest.Create) => {
		const newCredential = await CredentialsService.prepareCreateData(req.body);

		const encryptionKey = await CredentialsService.getEncryptionKey();
		const encryptedData = CredentialsService.createEncryptedData(
			encryptionKey,
			null,
			newCredential,
		);
		const { id, ...rest } = await CredentialsService.save(newCredential, encryptedData, req.user);

		return { id: id.toString(), ...rest };
	}),
);

/**
 * DELETE /credentials/:id
 */
credentialsController.delete(
	'/:id',
	ResponseHelper.send(async (req: CredentialRequest.Delete) => {
		const { id: credentialId } = req.params;

		const shared = await CredentialsService.getShared(req.user, credentialId);

		if (!shared) {
			LoggerProxy.info('Attempt to delete credential blocked due to lack of permissions', {
				credentialId,
				userId: req.user.id,
			});
			throw new ResponseHelper.ResponseError(
				`Credential with ID "${credentialId}" could not be found to be deleted.`,
				undefined,
				404,
			);
		}

		await CredentialsService.delete(shared.credentials);

		return true;
	}),
);

/**
 * PATCH /credentials/:id
 */
credentialsController.patch(
	'/:id',
	ResponseHelper.send(async (req: CredentialRequest.Update): Promise<ICredentialsResponse> => {
		const { id: credentialId } = req.params;

		const shared = await CredentialsService.getShared(req.user, credentialId);

		if (!shared) {
			LoggerProxy.info('Attempt to update credential blocked due to lack of permissions', {
				credentialId,
				userId: req.user.id,
			});
			throw new ResponseHelper.ResponseError(
				`Credential with ID "${credentialId}" could not be found to be updated.`,
				undefined,
				404,
			);
		}

		const { credentials: credential } = shared;

		const encryptionKey = await CredentialsService.getEncryptionKey();
		const decryptedData = await CredentialsService.decrypt(encryptionKey, credential);
		const preparedCredentialData = await CredentialsService.prepareUpdateData(
			req.body,
			decryptedData,
		);
		const newCredentialData = CredentialsService.createEncryptedData(
			encryptionKey,
			credentialId,
			preparedCredentialData,
		);

		const responseData = await CredentialsService.update(credentialId, newCredentialData);

		if (responseData === undefined) {
			throw new ResponseHelper.ResponseError(
				`Credential ID "${credentialId}" could not be found to be updated.`,
				undefined,
				404,
			);
		}

		// Remove the encrypted data as it is not needed in the frontend
		const { id, data, ...rest } = responseData;

		LoggerProxy.verbose('Credential updated', { credentialId });

		return {
			id: id.toString(),
			...rest,
		};
	}),
);

/**
 * GET /credentials/:id
 */
credentialsController.get(
	'/:id',
	ResponseHelper.send(async (req: CredentialRequest.Get) => {
		const { id: credentialId } = req.params;

		const shared = await CredentialsService.getShared(req.user, credentialId, ['credentials']);

		if (!shared) {
			throw new ResponseHelper.ResponseError(
				`Credentials with ID "${credentialId}" could not be found.`,
				undefined,
				404,
			);
		}

		const { credentials: credential } = shared;

		if (req.query.includeData !== 'true') {
			const { data, id, ...rest } = credential;

			return {
				id: id.toString(),
				...rest,
			};
		}

		const { data, id, ...rest } = credential;

		const encryptionKey = await CredentialsService.getEncryptionKey();
		const decryptedData = await CredentialsService.decrypt(encryptionKey, credential);

		return {
			id: id.toString(),
			data: decryptedData,
			...rest,
		};
	}),
);