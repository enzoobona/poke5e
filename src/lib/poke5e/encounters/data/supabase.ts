import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js"
import { DetailedError } from "$lib/site/errors"
import type { ReadWriteKey } from "$lib/trainers/types"
import { EncounterLocalStorage } from "./EncounterLocalStorage"
import type {
	EncounterPresetData,
	EncounterPresetInfo,
	EncounterPresetProvider,
	StoredEncounterPreset,
} from "./types"

export class EncounterProviderError extends DetailedError {
	constructor(message: string, readonly diagnostics?: PostgrestError) {
		super(
			message + (diagnostics?.code ? ` Code: ${diagnostics?.code}` : ""),
			diagnostics ? `Code: ${diagnostics.code}; ${diagnostics.message}` : "",
			diagnostics,
		)
	}
}

type InfoRow = { id: string, name: string, updated_at: string }
type FullRow = InfoRow & { data: EncounterPresetData }

export class SupabaseEncounterProvider implements EncounterPresetProvider {
	constructor(private supabase: SupabaseClient) {}

	allPresets = async (): Promise<EncounterPresetInfo[]> => {
		const readKeys = EncounterLocalStorage.getReadKeys()
		const infos = await Promise.all(readKeys.map((readKey) => this.getOneInfo(readKey)))
		return infos.filter((it): it is EncounterPresetInfo => it != null)
	}

	private getOneInfo = async (readKey: ReadWriteKey): Promise<EncounterPresetInfo | undefined> => {
		const { data, error } = await this.supabase.rpc("get_encounter_info", { _read_key: readKey })
			.maybeSingle<InfoRow>()

		if (error) throw new EncounterProviderError(`Could not get encounter info (${readKey}).`, error)
		if (!data) return undefined

		return { id: data.id, readKey, name: data.name, updatedAt: data.updated_at }
	}

	getPreset = async (readKey: ReadWriteKey): Promise<StoredEncounterPreset | undefined> => {
		const { data, error } = await this.supabase.rpc("get_encounter", { _read_key: readKey })
			.maybeSingle<FullRow>()

		if (error) throw new EncounterProviderError(`Could not get encounter (${readKey}).`, error)
		if (!data) return undefined

		EncounterLocalStorage.addReadKey(readKey)

		return {
			info: { id: data.id, readKey, name: data.name, updatedAt: data.updated_at },
			data: data.data,
			writeKey: EncounterLocalStorage.getWriteKey(readKey),
		}
	}

	newPreset = async (name: string, presetData: EncounterPresetData) => {
		const { data, error } = await this.supabase.rpc("new_encounter", {
			_name: name,
			_data: presetData,
		}).single<{ ret_id: string, ret_read_key: string, ret_write_key: string }>()

		if (error) throw new EncounterProviderError("Could not create encounter.", error)

		EncounterLocalStorage.addReadKey(data.ret_read_key)
		EncounterLocalStorage.addWriteKey(data.ret_read_key, data.ret_write_key)

		return {
			info: { id: data.ret_id, readKey: data.ret_read_key, name, updatedAt: new Date().toISOString() },
			data: presetData,
			writeKey: data.ret_write_key,
		}
	}

	updatePreset = async (writeKey: ReadWriteKey, name: string, presetData: EncounterPresetData): Promise<boolean> => {
		const { data, error } = await this.supabase.rpc("update_encounter", {
			_write_key: writeKey,
			_name: name,
			_data: presetData,
		}).single<number>()

		if (error) throw new EncounterProviderError("Could not update encounter.", error)
		if (data <= 0) throw new EncounterProviderError("Either this encounter does not exist or you do not have permission to edit it.")

		return data > 0
	}

	deletePreset = async (writeKey: ReadWriteKey, readKey: ReadWriteKey): Promise<boolean> => {
		const { data, error } = await this.supabase.rpc("delete_encounter", { _write_key: writeKey }).single<number>()

		if (error) throw new EncounterProviderError("Could not delete encounter.", error)

		EncounterLocalStorage.removeWriteKey(readKey)
		EncounterLocalStorage.removeReadKey(readKey)

		return data > 0
	}
}