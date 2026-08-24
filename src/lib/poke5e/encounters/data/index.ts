import { supabase } from "$lib/supabase"
import { SupabaseEncounterProvider } from "./supabase"

export type {
	EncounterPresetData,
	EncounterPresetInfo,
	StoredEncounterPreset,
	EncounterPresetProvider,
} from "./types"

export const encounterPresetProvider = new SupabaseEncounterProvider(supabase)