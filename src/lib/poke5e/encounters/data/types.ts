import type { Data } from "$lib/DataClass"
import type { PokemonSpecies } from "$lib/poke5e/species"
import type { ReadWriteKey } from "$lib/trainers/types"
import type { EncounterTrainer } from ".."

export type StoredEncounterActor = {
	species: Data<PokemonSpecies>,
	level: number,
	count: number,
	initiative?: number,
}

export type EncounterPresetData = {
	pokemon: StoredEncounterActor[],
	trainers: EncounterTrainer[],
}

export type EncounterPresetInfo = {
	id: string,
	readKey: ReadWriteKey,
	name: string,
	updatedAt: string,
}

export type StoredEncounterPreset = {
	info: EncounterPresetInfo,
	data: EncounterPresetData,
	writeKey?: ReadWriteKey,
}

export interface EncounterPresetProvider {
	allPresets: () => Promise<EncounterPresetInfo[]>
	getPreset: (readKey: ReadWriteKey) => Promise<StoredEncounterPreset | undefined>
	newPreset: (name: string, data: EncounterPresetData) => Promise<StoredEncounterPreset & { writeKey: ReadWriteKey }>
	updatePreset: (writeKey: ReadWriteKey, name: string, data: EncounterPresetData) => Promise<boolean>
	deletePreset: (writeKey: ReadWriteKey, readKey: ReadWriteKey) => Promise<boolean>
}