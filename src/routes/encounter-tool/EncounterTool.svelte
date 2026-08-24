<script lang="ts">
	import { MovesStore } from "$lib/moves/store"
	import { onMount } from "svelte"
	import { Encounter, ENCOUNTER_SIZE_LIMIT, type EncounterTrainer, uniqueId } from "$lib/poke5e/encounters"
	import { encounterPresetProvider, type EncounterPresetInfo, type EncounterPresetData } from "$lib/poke5e/encounters/data"
	import { EncounterLocalStorage } from "$lib/poke5e/encounters/data/EncounterLocalStorage"
	import { experienceAwarded } from "$lib/poke5e/experience"
	import type { Biome } from "$lib/poke5e/habitat"
	import { PokemonSpecies, PokemonSpeciesList } from "$lib/poke5e/species"
	import { SpeciesSprite } from "$lib/poke5e/species/media"
	import { PokemonType, TypeTag, type PokeType } from "$lib/pokemon/types"
	import { defensiveMultipliers } from "@auroratide/pokemon-types"
	import { error } from "$lib/site/errors"
	import { Button, Loader, ResourceBar } from "$lib/ui/elements"
	import { GenderIcon } from "$lib/pokemon/gender"
	import StatusTag from "$lib/pokemon/StatusTag.svelte"
	import Stepper from "$lib/ui/elements/Stepper.svelte"
	import { ActionArea, InstructionText, IntField, Removable, Saveable, SelectField, TextField } from "$lib/ui/forms"
	import { VsIcon } from "$lib/ui/icons"
	import { Page } from "$lib/ui/layout"
	import { MAIN_SEARCH_ID } from "$lib/ui/layout/SkipLinks.svelte"
	import Card from "$lib/ui/page/Card.svelte"
	import { tick } from "svelte"
	import type { Readable } from "svelte/store"
	import * as strings from "$lib/utils/string"
	import type { CombatCombatant } from "$lib/poke5e/encounters"
	import Info from "$lib/trainers/pokemon-details/Info.svelte"
	import { TagList } from "$lib/poke5e/tags"
	import type { Trainer, LearnedMove, TrainerPokemon } from "$lib/trainers/types"
	import { ListHeading } from "$lib/ui/page"
	import { ensureDataPersistance } from "$lib/site/storage"
	import { trainers } from "$lib/trainers/trainers"
	import { get } from "svelte/store"
	import { Url } from "$lib/site/url"

	const NONE = ""
	const noneOption = { name: "- None -", value: NONE }
	const primaryTypeOptions = [noneOption].concat(PokemonType.list.map((it) => ({ name: it, value: it })))
	const generationOptions = [{ name: "- Any -", value: "" }].concat(
		Array.from({ length: 9 }, (_, i) => ({ name: `Gen ${i + 1}`, value: String(i + 1) })),
	)
	const attackTypeOptions = [{ name: "Typeless (no multiplier)", value: "" }].concat(PokemonType.list.map((it) => ({ name: PokemonType.name(it), value: it })))
	const difficultyOptions = [
		{name: "Low", value: "low"},
		{name: "Moderate", value: "moderate"},
		{name: "High", value: "high"},
	]
	const pokemonLimitOptions = [
		{name: "No", value: "no"},
		{name: "Yes", value: "yes"},
	]
	const difficultyMultipliers = {
		low: 1,
		moderate: 1.5,
		high: 2,
	}
	const regionTypeOptions = [ {
		name: "Native to",
		value: "native",
	}, {
		name: "Found in",
		value: "found in",
	} ]

	export let biomes: Biome[]
	export let species: Readable<PokemonSpecies[] | undefined>

	$: biomeOptions = [
		{ name: "- None -", value: "" },
		...(biomes ?? []).map((t: { name: string, id: string }) => ({
			name: t.name,
			value: t.id,
		})),
	]
	$: maxPlayerLevel = partyPlayers.length > 0 
		? Math.max(...partyPlayers.map(p => p.level)) 
		: 1
	$: totalPartyLevels = partyPlayers.reduce((sum, p) => sum + p.level, 0)
	$: pokemonExtraModifier = partyPlayers.reduce((acc, p) => {
		const extra = p.numberOfPokemon > 1 ? (p.numberOfPokemon - 1) * 0.1 : 0
		return acc + extra
	}, 0)
	$: maxExpTotal = Math.round((totalPartyLevels * 50) * (1 + pokemonExtraModifier) * difficultyMultipliers[difficulty])

	// This forces the fetching of moves so PP is accurate
	$: possibleMoves = $MovesStore

	let biome = ""
	let difficulty: "low" | "moderate" | "high" = "low"
	let pokemonType: PokeType
	let regionType: "native" | "found in" = "native"
	let regionName: string = ""
	let generation: string = ""
	let arePokemonLimited: "yes" | "no" = "no"
	let pokemonLimit: number = 1
	let encounter = Encounter.createEmpty()
	let noMatches = false
	let partyPlayers: EncounterTrainer[] = []
	let reviewModalOpen = false

	let trackerActive = false
	let combatants: CombatCombatant[] = []

	let selectedCombatantId: string | number | null = null

	$: sortedCombatants = [...combatants].sort((a, b) => b.initiative - a.initiative)
	$: selectedCombatant = combatants.find((c) => c.id === selectedCombatantId) ?? null

	let activePokemonTargetPlayerId: string | null = null

	const openActivePokemonPicker = (playerId: string) => {
		activePokemonTargetPlayerId = playerId
		addPokemonModalOpen = true
	}

	const emptySpecializations = {
		ghost: 0, fairy: 0, normal: 0, fighting: 0, flying: 0, poison: 0,
		fire: 0, grass: 0, water: 0, electric: 0, psychic: 0, dark: 0,
		bug: 0, ice: 0, dragon: 0, steel: 0, rock: 0, ground: 0,
	}
	const fakeTrainer = { specializations: emptySpecializations } as unknown as Trainer

	let presets: EncounterPresetInfo[] = []
	let activePreset: { readKey: string, writeKey?: string, name: string } | null = null
	let openMenuFor: string | null = null // readKey del preset con el menú de 3 puntos abierto

	$: currentEncounterExp = Encounter.totalExp(encounter)
	$: encounterDifficulty = (() => {
		const ratio = currentEncounterExp / maxExpTotal * difficultyMultipliers[difficulty]
		if (ratio < 0.9) return { label: "Trivial", color: "#9e9e9e" }
		if (ratio <= 1.15) return { label: "Low", color: "#4caf50" }
		if (ratio <= 1.5) return { label: "Moderate", color: "#ff9800" }
		if (ratio <= 2) return { label: "High", color: "#f44336" }
		return { label: "Deadly", color: "#7b1fa2" }
	})()

	let addPokemonModalOpen = false

	const openAddPokemonModal = () => {
		activePokemonTargetPlayerId = null
		addPokemonModalOpen = true
	}

	const closeAddPokemonModal = () => {
		addPokemonModalOpen = false
		activePokemonTargetPlayerId = null
	}

	const addPokemonToTrackerFromModal = (pokemon: PokemonSpecies) => {
		addPokemonToTracker(pokemon)
		addPokemonModalOpen = false
	}

	const onModalPokemonClick = (pokemon: PokemonSpecies) => {
		if (activePokemonTargetPlayerId != null) {
			const targetId = activePokemonTargetPlayerId
			if (trackerActive) {
				combatants = combatants.map((c) =>
					c.kind === "trainer" && c.id === targetId
						? { ...c, activePokemon: { species: pokemon, level: c.activePokemon?.level ?? c.level } }
						: c,
				)
			} else {
				partyPlayers = partyPlayers.map((p) =>
					p.id === targetId
						? { ...p, activePokemon: { species: pokemon.data, level: p.level } }
						: p,
				)
			}
			activePokemonTargetPlayerId = null
			addPokemonModalOpen = false
		} else {
			addPokemonToTrackerFromModal(pokemon)
		}
	}

	let damageModalOpen = false
	let damageAttackType: PokeType | "" = ""
	let damageAmount: number = 0

	const openDamageModal = () => {
		damageAttackType = ""
		damageAmount = 0
		damageModalOpen = true
	}

	const closeDamageModal = () => {
		damageModalOpen = false
	}

	$: damageMultiplier = damageAttackType !== "" && selectedCombatant?.kind === "pokemon"
		? defensiveMultipliers(selectedCombatant.pokemon.type.data)[damageAttackType] ?? 1
		: 1

	$: computedDamage = Math.round(damageAmount * damageMultiplier)

	const applyDamage = () => {
		if (selectedCombatant?.kind !== "pokemon" || damageAmount <= 0) return

		const current = selectedCombatant.pokemon.hp.current
		const max = selectedCombatant.pokemon.hp.max
		const newCurrent = Math.max(0, Math.min(max, current - computedDamage))

		patchCombatantPokemon({
			...selectedCombatant.pokemon,
			hp: { ...selectedCombatant.pokemon.hp, current: newCurrent },
		})

		damageModalOpen = false
	}

	let namePromptOpen = false
	let namePromptTitle = ""
	let namePromptValue = ""
	let namePromptResolve: ((value: string | null) => void) | null = null

	const promptForName = (title: string, initial: string = ""): Promise<string | null> => {
		namePromptTitle = title
		namePromptValue = initial
		namePromptOpen = true

		return new Promise((resolve) => {
			namePromptResolve = resolve
		})
	}

	const confirmNamePrompt = () => {
		const value = namePromptValue.trim()
		namePromptOpen = false
		namePromptResolve?.(value || null)
		namePromptResolve = null
	}

	const cancelNamePrompt = () => {
		namePromptOpen = false
		namePromptResolve?.(null)
		namePromptResolve = null
	}

	let confirmPromptOpen = false
	let confirmPromptTitle = ""
	let confirmPromptMessage = ""
	let confirmPromptResolve: ((value: boolean) => void) | null = null

	const promptForConfirm = (title: string, message: string): Promise<boolean> => {
		confirmPromptTitle = title
		confirmPromptMessage = message
		confirmPromptOpen = true

		return new Promise((resolve) => {
			confirmPromptResolve = resolve
		})
	}

	const acceptConfirmPrompt = () => {
		confirmPromptOpen = false
		confirmPromptResolve?.(true)
		confirmPromptResolve = null
	}

	const cancelConfirmPrompt = () => {
		confirmPromptOpen = false
		confirmPromptResolve?.(false)
		confirmPromptResolve = null
	}

	onMount(() => {
		ensureDataPersistance()
	})

	onMount(async () => {
		try {
			presets = await encounterPresetProvider.allPresets()
		} catch (e) {
			error.show("Encounter.loadPresets", e as Error)
		}
	})

	onMount(() => {
		const selectNumberInputOnFocus = (e: FocusEvent) => {
			const target = e.target as HTMLElement
			if (target instanceof HTMLInputElement && target.type === "number") {
				target.select()
			}
		}
		document.addEventListener("focusin", selectNumberInputOnFocus)
		return () => document.removeEventListener("focusin", selectNumberInputOnFocus)
	})

	const selectCombatant = (id: string | number) => {
		selectedCombatantId = selectedCombatantId === id ? null : id
	}

	const removeCombatant = (id: string | number) => {
		combatants = combatants.filter((c) => c.id !== id)
		if (selectedCombatantId === id) selectedCombatantId = null
	}

	const onTrackerKeydown = (e: KeyboardEvent) => {
		if (!trackerActive) return
		const target = e.target as HTMLElement
		const isTyping = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable
		if (isTyping) return
		if ((e.key === "Delete" || e.key === "Backspace") && selectedCombatantId != null) {
			removeCombatant(selectedCombatantId)
		}
	}

	const patchCombatantPokemon = (updated: TrainerPokemon) => {
		combatants = combatants.map((c) =>
			c.kind === "pokemon" && c.pokemon.id === updated.id
				? { ...c, pokemon: updated }
				: c,
		)
	}

	const onUpdateHealth = (e: CustomEvent<TrainerPokemon>) => patchCombatantPokemon(e.detail)
	const onUpdateBond = (e: CustomEvent<TrainerPokemon>) => patchCombatantPokemon(e.detail)
	const onUpdateTags = (e: CustomEvent<TrainerPokemon>) => patchCombatantPokemon(e.detail)

	const onUpdatePp = (e: CustomEvent<LearnedMove>) => {
		combatants = combatants.map((c) => {
			if (c.kind !== "pokemon") return c
			const idx = c.pokemon.moves.findIndex((m) => m.id === e.detail.id)
			if (idx === -1) return c
			const moves = [...c.pokemon.moves]
			moves[idx] = e.detail
			return { ...c, pokemon: { ...c.pokemon, moves } }
		})
	}

	function portal(node: HTMLElement) {
		document.body.appendChild(node)
		return {
			destroy() {
				node.remove()
			},
		}
	}

	function clickOutside(node: HTMLElement, callback: () => void) {
		const handleClick = (event: MouseEvent) => {
			if (!node.contains(event.target as Node)) {
				callback()
			}
		}
		document.addEventListener("click", handleClick, true)
		return {
			destroy() {
				document.removeEventListener("click", handleClick, true)
			},
		}
	}

	const addPlayer = () => {
		const id = uniqueId()
		partyPlayers = [...partyPlayers, { id, name: "Trainer", level: 1, numberOfPokemon: 1 }]
	}

	const deletePlayer = (id: string) => {
		partyPlayers = partyPlayers.filter(p => p.id !== id)
	}

	const addPokemonToEncounter = (pokemon: PokemonSpecies, level?: number) => {
		if (!partyPlayers.length) {
			addPlayer()
		}

		encounter = Encounter.addPokemon(encounter, pokemon, level ?? 1)
		console.log(pokemon.generation)
		console.log(pokemon.habitat.nativeRegion)
		noMatches = false
	}

	const onDelete = (pokemon: {data: PokemonSpecies, count: number}) => {
		encounter = Encounter.removePokemon(encounter, pokemon.data)
	}
	
	const addPokemonToTracker = (pokemon: PokemonSpecies) => {
		const roll = Encounter.rollInitiative(pokemon.attributes.dex.modifier)
		const creature = Encounter.buildOneCombatCreature(pokemon, maxPlayerLevel, roll.total, roll.natural, possibleMoves)
		combatants = [...combatants, creature]
	}

	const exitTracker = () => {
		trackerActive = false
		combatants = []
		selectedCombatantId = null
	}

	const openReviewModal = () => {
		encounter.pokemon.forEach((pokemon) => {
			pokemon.rolls = Array.from({ length: pokemon.count }, () =>
				Encounter.rollInitiative(pokemon.data.attributes.dex.modifier),
			)
		})
		encounter = { ...encounter, pokemon: [...encounter.pokemon] }

		partyPlayers.forEach((p) => {
			p.initiativeRoll = { natural: 0, total: p.initiativeRoll?.total ?? p.initiative ?? 0 }
		})
		partyPlayers = [...partyPlayers]

		reviewModalOpen = true
	}

	const closeReviewModal = () => {
		reviewModalOpen = false
	}

	let linkTrainerModalOpen = false
	let linkTrainerListValue: Trainer[] | undefined = undefined
	let linkTrainerListLoading = false
	let linkTrainerSearching = false
	let linkTrainerError = ""

	const openLinkTrainerModal = () => {
		linkTrainerError = ""
		linkTrainerListValue = undefined
		linkTrainerListLoading = true
		linkTrainerModalOpen = true

		trainers.all()
			.then((store) => {
				if (!store) {
					linkTrainerError = "No se pudo cargar la lista de entrenadores."
					return
				}
				linkTrainerListValue = get(store) as Trainer[]
			})
			.catch(() => {
				linkTrainerError = "Ocurrió un error al buscar tus entrenadores."
			})
			.finally(() => {
				linkTrainerListLoading = false
			})
	}

	const closeLinkTrainerModal = () => {
		linkTrainerModalOpen = false
	}

	const selectLinkedTrainer = async (trainerInfo: { readKey: string, name: string, level: { data: number } }) => {
		linkTrainerSearching = true
		linkTrainerError = ""
		try {
			const store = await trainers.get(trainerInfo.readKey)
			if (!store) {
				linkTrainerError = "No se pudo cargar ese entrenador."
				return
			}
			const value = get(store)
			partyPlayers = [...partyPlayers, {
				id: uniqueId(),
				name: value.info.name,
				level: value.info.level.data,
				numberOfPokemon: value.pokemon.length,
				linkedTrainerId: trainerInfo.readKey,
			}]
			linkTrainerModalOpen = false
		} finally {
			linkTrainerSearching = false
		}
	}

	const generateEncounter = async () => {
		// Generate default party if there is none
		if (!partyPlayers.length) {
			for (let index = 0; index < 4; index++) {
				addPlayer()
			}
			// So Svelte can trigger the changes in the side variables
			await tick()
		}

		const pokemonPool: PokemonSpecies[] = []
		const currentSpecies = $species ?? []

		// Add Pokémon to the pool
		for (let i = 0; i < currentSpecies.length; i++) {
			const pokemon = currentSpecies[i]
			const hasBiome = biome === "" || pokemon.data.habitat.biomes.includes(biome)
			const hasType = !pokemonType || pokemon.data.type.includes(pokemonType)
			const hasGeneration = generation === "" || (pokemon.generation != null && String(pokemon.generation) === generation)

			let hasRegion = true
			if (regionType === "native") {
				hasRegion = regionName?.trim() === "" || strings.caseInsensitiveEqual(pokemon.data.habitat.nativeRegion, regionName)
			} else if (regionType === "found in") {
				hasRegion = regionName?.trim() === "" || pokemon.data.habitat.regions.some((region) => strings.caseInsensitiveEqual(region, regionName))
			}

			if (hasBiome && hasType && hasRegion && hasGeneration) {
				pokemonPool.push(pokemon)
			}
		}

		if (pokemonPool.length === 0) {
			noMatches = true
			return
		}

		encounter = Encounter.generate({
			pool: pokemonPool,
			targetExp: maxExpTotal,
			pokemonLimit: arePokemonLimited === "yes" ? pokemonLimit : Infinity,
			maxLevel: maxPlayerLevel,
		})

		if (encounter.pokemon.length === 0) {
			noMatches = true
		}
	}

	const clearEncounter = () => {
		encounter = Encounter.createEmpty()
		reviewModalOpen = false
		activePreset = null
		trackerActive = false
		combatants = []
		selectedCombatantId = null
	}

	const confirmUseEncounter = () => {
		const creatures = encounter.pokemon.flatMap((actor) =>
			(actor.rolls ?? []).map((roll, i) =>
				Encounter.buildOneCombatCreature(
					actor.data,
					actor.level,
					roll.total,
					roll.natural,
					possibleMoves,
					actor.count > 1 ? `${actor.data.name} ${i + 1}` : undefined,
				),
			),
		)

		const trainerEntries: CombatCombatant[] = partyPlayers.map((p) => ({
			id: p.id,
			kind: "trainer" as const,
			name: p.name?.trim() || `Trainer ${p.id}`,
			level: p.level,
			numberOfPokemon: p.numberOfPokemon,
			initiative: p.initiativeRoll?.total ?? p.initiative ?? 0,
			activePokemon: p.activePokemon
				? { species: new PokemonSpecies(p.activePokemon.species), level: p.activePokemon.level }
				: undefined,
			linkedTrainerId: p.linkedTrainerId,
		}))

		combatants = [...creatures, ...trainerEntries]
		reviewModalOpen = false
		trackerActive = true
	}

	$: saveEncounterIssues = Encounter.count(encounter) === 0
		? "Add Pokémon to this encounter to save it."
		: Encounter.count(encounter) > ENCOUNTER_SIZE_LIMIT
			? `Reduce the number of Pokémon in this encounter to ${ENCOUNTER_SIZE_LIMIT} or less to save it.`
			: undefined

	// --- Presets ---
	const savePreset = async () => {
		const name = await promptForName("Save Encounter", activePreset?.name ?? "")
		if (!name) return

		const presetData: EncounterPresetData = {
			pokemon: encounter.pokemon.map((p) => ({
				species: p.data.data,
				level: p.level,
				count: p.count,
				initiative: p.initiative,
			})),
			trainers: partyPlayers,
		}

		try {
			if (activePreset?.writeKey && activePreset.name === name) {
				// Mismo nombre y ya tenemos permiso de escritura -> sobreescribe
				await encounterPresetProvider.updatePreset(activePreset.writeKey, name, presetData)
			} else {
				const created = await encounterPresetProvider.newPreset(name, presetData)
				activePreset = { readKey: created.info.readKey, writeKey: created.writeKey, name }
			}
			presets = await encounterPresetProvider.allPresets()
		} catch (e) {
			error.show("Encounter.savePreset", e as Error)
		}
	}

	const loadPreset = async (info: EncounterPresetInfo) => {
		try {
			const preset = await encounterPresetProvider.getPreset(info.readKey)
			if (!preset) return

			encounter = {
				pokemon: preset.data.pokemon.map((p) => ({
					data: new PokemonSpecies(p.species),
					level: p.level,
					count: p.count,
					initiative: p.initiative,
				})),
			}
			partyPlayers = preset.data.trainers.map((t) => ({
				...t,
				name: t.name ?? `Trainer ${t.id}`,
			}))
			reviewModalOpen = false
			activePreset = { readKey: preset.info.readKey, writeKey: preset.writeKey, name: preset.info.name }
			openMenuFor = null
		} catch (e) {
			error.show("Encounter.loadPreset", e as Error)
		}
	}

	const renamePreset = async (info: EncounterPresetInfo) => {
		openMenuFor = null

		const writeKey = EncounterLocalStorage.getWriteKey(info.readKey)

		if (!writeKey) {
			error.show("Encounter.renamePreset", new Error("No tenés permiso para editar esta encounter (fue creada desde otro navegador)."))
			return
		}

		const newName = await promptForName("Rename Encounter", info.name)
		if (!newName) return

		try {
			const preset = await encounterPresetProvider.getPreset(info.readKey)
			if (!preset) return

			await encounterPresetProvider.updatePreset(writeKey, newName, preset.data)
			presets = await encounterPresetProvider.allPresets()
		} catch (e) {
			error.show("Encounter.renamePreset", e as Error)
		}
	}

	const deletePreset = async (info: EncounterPresetInfo) => {
		openMenuFor = null

		const writeKey = EncounterLocalStorage.getWriteKey(info.readKey)

		if (!writeKey) {
			error.show("Encounter.deletePreset", new Error("No tenés permiso para eliminar esta encounter (fue creada desde otro navegador)."))
			return
		}

		const confirmed = await promptForConfirm("Delete Encounter", `¿Eliminar "${info.name}"? Esta acción no se puede deshacer.`)
		if (!confirmed) return

		try {
			await encounterPresetProvider.deletePreset(writeKey, info.readKey)
			presets = presets.filter((it) => it.readKey !== info.readKey)
			if (activePreset?.readKey === info.readKey) activePreset = null
		} catch (e) {
			error.show("Encounter.deletePreset", e as Error)
		}
	}


	$: combatOrder = reviewModalOpen
		? [
			...encounter.pokemon.flatMap((p) =>
				(p.rolls ?? []).map((roll, i) => ({
					key: `${p.data.id.data}-${i}`,
					name: p.count > 1 ? `${p.data.name} ${i + 1}` : p.data.name,
					kind: "pokemon" as const,
					roll,
				})),
			),
			...partyPlayers.map((p) => ({
				key: `trainer-${p.id}`,
				name: p.name?.trim() || `Trainer ${p.id}`,
				kind: "trainer" as const,
				roll: p.initiativeRoll ?? { natural: 0, total: p.initiative ?? 0 },
			})),
		].sort((a, b) => b.roll.total - a.roll.total)
		: []

	
</script>

<svelte:window on:keydown={onTrackerKeydown} />

<Page theme="forest">
	<VsIcon slot="icon" />
	
	<nav id="{MAIN_SEARCH_ID}" slot="side" class="table" aria-label="Pokémon List">
		{#if trackerActive}
			<ListHeading title="Combat Tracker" target="/encounter-tool">
				<span slot="action" class="tracker-header-actions">
					<Button on:click={openAddPokemonModal}>+ Add</Button>
					<Button variant="danger" on:click={exitTracker}>End</Button>
				</span>
			</ListHeading>
			<div class="relative">
				<div class="scrollable">
					<ul class="nolist no-space full-width">
						{#each sortedCombatants as combatant (combatant.id)}
							<li class="space-after">
								<div class="side-by-side">
									<button
										type="button"
										class="selectable-bubble"
										class:gridded={combatant.kind === "pokemon"}
										class:trainer-bubble={combatant.kind === "trainer"}
										class:selected={selectedCombatantId === combatant.id}
										on:click={() => selectCombatant(combatant.id)}
									>
										{#if combatant.kind === "pokemon"}
											<span style:grid-area="sprite" class="max-height jumping-animation">
												<SpeciesSprite media={combatant.species.media} alt={combatant.species.name} />
												{#if combatant.species.media.sprite().value != null}
													<span class="shadow"></span>
												{/if}
											</span>
											<span style:grid-area="name">{combatant.pokemon.nickname}</span>
											<span style:grid-area="gender" class="right away-from-edge flex"><GenderIcon gender={combatant.pokemon.gender} /></span>
											<span style:grid-area="hpbar" class="away-from-edge"><ResourceBar current={combatant.pokemon.hp.current} max={combatant.pokemon.hp.max} /></span>
											<span style:grid-area="hp">{combatant.pokemon.hp.current}/{combatant.pokemon.hp.max}</span>
											<span style:grid-area="status" class="smaller-text">{#if combatant.pokemon.status != null}<StatusTag abbr value={combatant.pokemon.status} />{/if}</span>
											<span style:grid-area="lv" class="right">Lv. {combatant.pokemon.level.data}</span>
										{:else}
											<span style:grid-area="name" class="trainer-name">{combatant.name}</span>
											<span style:grid-area="details" class="smaller-text">Lv. {combatant.level} • {combatant.numberOfPokemon} Pokémon</span>
										{/if}
										<span style:grid-area="initiative" class="initiative" title="Initiative">
											{combatant.initiative}
											{#if combatant.kind === "pokemon" && combatant.initiativeNatural === 20}<span class="nat-badge nat20" title="Natural 20">★</span>{/if}
											{#if combatant.kind === "pokemon" && combatant.initiativeNatural === 1}<span class="nat-badge nat1" title="Natural 1">⚠</span>{/if}
										</span>
									</button>
								</div>
							</li>
						{/each}
					</ul>
				</div>
			</div>
		{:else if $species !== undefined}
			<PokemonSpeciesList pokemons={$species ?? []} onClick={(pokemon) => addPokemonToEncounter(pokemon)} disableLink={true} />
		{:else}
			<Loader />
		{/if}
	</nav>
	
	{#if !trackerActive}
		<Card title="Encounter Tool">
			<Saveable saving={false}>
				<section>
					<p>Welcome to the Encounter Tool! Please, keep in mind that this system is being currently tested and might not be accurately balanced.</p>
				</section>
				<section>
					<h2>Encounters Guardadas</h2>
					{#if presets.length > 0}
						<ul class="preset-list">
							{#each presets as preset (preset.readKey)}
								<li class="preset-item">
									<button class="preset-name" on:click={() => loadPreset(preset)}>
										{preset.name}
									</button>
									<div
										class="preset-menu-wrapper"
										use:clickOutside={() => { if (openMenuFor === preset.readKey) openMenuFor = null }}
									>
										<button class="preset-menu-toggle" on:click={() => openMenuFor = openMenuFor === preset.readKey ? null : preset.readKey}>
											⋮
										</button>
										{#if openMenuFor === preset.readKey}
											<div class="preset-menu">
												<button on:click={() => renamePreset(preset)}>Editar nombre</button>
												<button on:click={() => deletePreset(preset)}>Eliminar</button>
											</div>
										{/if}
									</div>
								</li>
							{/each}
						</ul>
					{:else}
						<p>No hay encounters guardadas todavía.</p>
					{/if}
				</section>
				<section>
					<h2>Players</h2>
					{#if partyPlayers.length > 0}
						<div class="player-list">
							{#each partyPlayers as player}
								<div class="player-item">
									<Removable on:remove={() => deletePlayer(player.id)}>
										<div class="player-fields">
											<TextField label="Name" bind:value={player.name} />
											<IntField label="Level" bind:value={player.level} min={1} />
											<IntField label="Pokémon" bind:value={player.numberOfPokemon} min={1} />
										</div>
										<div class="active-pokemon-box">
											<div class="active-pokemon-info">
												{#if player.activePokemon}
													<span class="active-pokemon-sprite">
														<SpeciesSprite media={new PokemonSpecies(player.activePokemon.species).media} alt="" />
													</span>
													<span>{new PokemonSpecies(player.activePokemon.species).name} (Lv. {player.activePokemon.level})</span>
												{:else}
													<span class="smaller-text">No active Pokémon set.</span>
												{/if}
											</div>
											<Button variant="ghost" on:click={() => openActivePokemonPicker(player.id)}>
												{player.activePokemon ? "Change" : "Set"} Active Pokémon
											</Button>
										</div>
										{#if player.linkedTrainerId}
											<p class="linked-note">Vinculado a Trainer {player.linkedTrainerId}</p>
										{/if}
									</Removable>
								</div>
							{/each}
						</div>
					{:else}
						<p>No Players in the Party.</p>
					{/if}
					<div class="players-actions">
						<Button variant="success" on:click={addPlayer} width="full">Add Player</Button>
						<Button variant="ghost" on:click={openLinkTrainerModal} width="full">Link Existing Trainer</Button>
					</div>
				</section>
				<section>
					<h2>Configuration</h2>
					<div class="simple-type-field">
						<SelectField label="Biome" options={biomeOptions} bind:value={biome} />
						<SelectField label="Type in common" options={primaryTypeOptions} bind:value={pokemonType} />
					</div>
					<div class="simple-type-field">
						<SelectField label="Generation" options={generationOptions} bind:value={generation} />
					</div>
					<div class="simple-type-field">
						<SelectField label="Region Filter" options={regionTypeOptions} bind:value={regionType} />
						<TextField label="Region Name" bind:value={regionName} />
					</div>
					<div class="simple-type-field">
						<SelectField label="Difficulty" options={difficultyOptions} bind:value={difficulty} />
						<p class="xp-awarded">{maxExpTotal} XP</p>
					</div>
					<div class="simple-type-field">
						<SelectField label="Pokémon Limit" options={pokemonLimitOptions} bind:value={arePokemonLimited} />
						{#if arePokemonLimited === "yes"}
							<IntField label="Limit" bind:value={pokemonLimit} min={1} />
						{:else}
							<p></p>
						{/if}
					</div>
				
					<p class="larger">
						<Button on:click={generateEncounter} width="full" >Generate Encounter</Button>
					</p>
				</section>
				<section>
					<h2>Encounter</h2>
					<div class="manual-pokemon-list">
						{#if encounter.pokemon.length > 0}
							<div class="pokemon-list">
								{#each encounter.pokemon as pokemon (pokemon.data.id.data)}
									<div class="pokemon-item">
										<div class="pokemon-data">
											<div class="pokemon-sprite">
												<SpeciesSprite media={pokemon.data.media} alt="{pokemon.data.name}" />
											</div>
											<div class="pokemon-info">
												<p class="pokemon-name">
													{pokemon.data.name} 
													<label class="pokemon-level">Lv. <input type="number" min={1} bind:value={pokemon.level} /></label>
												</p>
												<p class="pokemon-stats">SR: {pokemon.data.sr} • XP: {experienceAwarded(pokemon.level, pokemon.data.data.sr)}</p>
												<TypeTag type={pokemon.data.data.type} />
											</div>
										</div>
										<Stepper bind:value={pokemon.count} deleteOnZero={true} on:delete={() => onDelete(pokemon)} />
									</div>
								{/each}
							</div>
						{:else if noMatches}
							<p class="no-matches">No Pokémon meet the criteria!</p>
						{:else}
							<p>No Pokémon added.</p>
						{/if}
						

					</div>
					<InstructionText>"Use Encounter" will add this to Trainers, allowing you to track HP, add moves, and manage the details.</InstructionText>
				</section>
				<ActionArea error={saveEncounterIssues}>
					<Button variant="danger" on:click={clearEncounter}>Clear</Button>
					<Button variant="ghost" on:click={savePreset} disabled={Encounter.count(encounter) === 0}>Save Encounter</Button>
					<Button on:click={openReviewModal} disabled={saveEncounterIssues != null}>Use Encounter</Button>
				</ActionArea>
			</Saveable>
		</Card>
	{:else if selectedCombatant == null}
		<Card title="Select a Combatant">
			<section>
				<p>Seleccioná un combatiente de la lista de la izquierda para ver sus detalles.</p>
			</section>
		</Card>
	{:else if selectedCombatant.kind === "pokemon"}
		<Card title={selectedCombatant.pokemon.nickname}>
			<TypeTag slot="header-extra" type={selectedCombatant.pokemon.type.data} />
			{#if selectedCombatant.initiativeNatural === 20}
				<section><p class="advantage-note">★ Rolled a natural 20 on initiative - started combat with advantage.</p></section>
			{:else if selectedCombatant.initiativeNatural === 1}
				<section><p class="disadvantage-note">⚠ Rolled a natural 1 on initiative - started combat with disadvantage.</p></section>
			{/if}
			<Info
				trainer={fakeTrainer}
				pokemon={selectedCombatant.pokemon}
				species={selectedCombatant.species}
				editable={true}
				pokemonTags={TagList.empty()}
				on:update-health={onUpdateHealth}
				on:update-pp={onUpdatePp}
				on:update-bond={onUpdateBond}
				on:update-tags={onUpdateTags}
			>
				<svelte:fragment slot="actions-extra">
					<button type="button" class="status-style-action" on:click={openDamageModal}>Apply Damage</button>
					<!-- Futuro: <button type="button" class="status-style-action" on:click={openItemModal}>Apply Item</button> -->
				</svelte:fragment>
			</Info>
		</Card>
	{:else}
		<Card title={selectedCombatant.name}>
			<section>
				<p>Level {selectedCombatant.level}</p>
				<p>{selectedCombatant.numberOfPokemon} Pokémon</p>
				{#if selectedCombatant.linkedTrainerId}
					<p><a href="{Url.trainers(selectedCombatant.linkedTrainerId)}" target="_blank" rel="noopener">Ver ficha completa del entrenador ↗</a></p>
				{/if}
			</section>
			<section>
				<h3>Active Pokémon</h3>
				<div class="active-pokemon-box">
					<div class="active-pokemon-info">
						{#if selectedCombatant.activePokemon}
							<span class="active-pokemon-sprite">
								<SpeciesSprite media={selectedCombatant.activePokemon.species.media} alt="" />
							</span>
							<span>{selectedCombatant.activePokemon.species.name}</span>
						{:else}
							<span class="smaller-text">No active Pokémon set.</span>
						{/if}
					</div>
					<Button variant="ghost" on:click={() => openActivePokemonPicker(selectedCombatant.id)}>
						{selectedCombatant.activePokemon ? "Change" : "Set"} Active Pokémon
					</Button>
				</div>
			</section>
		</Card>
	{/if}


	{#if namePromptOpen}
		<div class="modal-backdrop" use:portal role="button" tabindex=-1 on:click={(e) => { if (e.target === e.currentTarget) cancelNamePrompt() }} on:keydown={(e) => { if (e.key === "Escape") cancelNamePrompt() }}>
			<form class="modal" on:submit|preventDefault={confirmNamePrompt}>
				<h3>{namePromptTitle}</h3>
				<TextField label="Name" bind:value={namePromptValue} />
				<div class="modal-actions">
					<Button type="button" variant="ghost" on:click={cancelNamePrompt}>Cancel</Button>
					<Button type="submit" disabled={!namePromptValue.trim()}>Save</Button>
				</div>
			</form>
		</div>
	{/if}

	{#if reviewModalOpen}
		<div class="modal-backdrop" use:portal role="button" tabindex=-1 on:click={(e) => { if (e.target === e.currentTarget) closeReviewModal()}} on:keydown={(e) => { if (e.key === "Escape") closeReviewModal() }} >
			<div class="modal review-modal">
				<h3>Confirm Encounter</h3>

				<div class="summary-box">
					<p><strong>Total XP Awarded:</strong> {currentEncounterExp}</p>
					<p><strong>XP per Player:</strong> {Math.round(currentEncounterExp / (partyPlayers.length || 1))}</p>
					<p>
						<strong>Difficulty:</strong>
						<span class="difficulty-badge" style="background-color: {encounterDifficulty.color}">
							{encounterDifficulty.label}
						</span>
					</p>
				</div>

				<div class="combat-order">
					<h4>Initiative Order</h4>
					<ol>
						{#each combatOrder as actor (actor.key)}
							<li class:trainer={actor.kind === "trainer"}>
								<span>
									{actor.name}
									{#if actor.roll.natural === 20}<span class="nat-badge nat20" title="Natural 20 — Advantage">ADV</span>{/if}
									{#if actor.roll.natural === 1}<span class="nat-badge nat1" title="Natural 1 — Disadvantage">DIS</span>{/if}
								</span>
								<input type="number" bind:value={actor.roll.total}/>
							</li>
						{/each}
					</ol>
				</div>

				<div class="modal-actions">
					<Button variant="ghost" type="button" on:click={closeReviewModal} >Cancel</Button>
					<Button type="button" on:click={confirmUseEncounter} >Confirm &amp; Save</Button>
				</div>
			</div>
		</div>
	{/if}

	{#if addPokemonModalOpen}
		<div class="modal-backdrop" use:portal role="button" tabindex=-1 on:click={(e) => { if (e.target === e.currentTarget) closeAddPokemonModal() }} on:keydown={(e) => { if (e.key === "Escape") closeAddPokemonModal() }}>
			<div class="modal add-pokemon-modal">
				<h3>{activePokemonTargetPlayerId != null ? "Set Active Pokémon" : "Add Pokémon to Combat"}</h3>
				<div class="add-pokemon-list">
					{#if $species !== undefined}
						<PokemonSpeciesList pokemons={$species ?? []} onClick={onModalPokemonClick} disableLink={true} />
					{:else}
						<Loader />
					{/if}
				</div>
				<div class="modal-actions">
					<Button variant="ghost" type="button" on:click={closeAddPokemonModal}>Close</Button>
				</div>
			</div>
		</div>
	{/if}

	{#if damageModalOpen && selectedCombatant?.kind === "pokemon"}
		<div
			class="modal-backdrop"
			use:portal
			role="button"
			tabindex="-1"
			on:click={(e) => { if (e.target === e.currentTarget) closeDamageModal() }}
			on:keydown={(e) => { if (e.key === "Escape") closeDamageModal() }}
		>
			<div class="modal damage-modal">
				<h3>Apply Damage to {selectedCombatant.pokemon.nickname}</h3>
				<SelectField label="Attack Type" options={attackTypeOptions} bind:value={damageAttackType} />
				<IntField label="Base Damage" bind:value={damageAmount} min={0} />
				{#if damageAttackType !== ""}
					<p class="multiplier-note">
						Effectiveness: ×{damageMultiplier}
						{#if damageMultiplier > 1}(Super Effective){:else if damageMultiplier > 0 && damageMultiplier < 1}(Not Very Effective){:else if damageMultiplier === 0}(No Effect){/if}
					</p>
				{/if}
				<p class="computed-damage">Damage to apply: <strong>{computedDamage}</strong> ({selectedCombatant.pokemon.hp.current} → {Math.max(0, selectedCombatant.pokemon.hp.current - computedDamage)} HP)</p>
				<div class="modal-actions">
					<Button variant="ghost" type="button" on:click={closeDamageModal}>Cancel</Button>
					<Button type="button" on:click={applyDamage} disabled={damageAmount <= 0}>Apply Damage</Button>
				</div>
			</div>
		</div>
	{/if}

	{#if confirmPromptOpen}
		<div
			class="modal-backdrop"
			use:portal
			role="button"
			tabindex="-1"
			on:click={(e) => { if (e.target === e.currentTarget) cancelConfirmPrompt() }}
			on:keydown={(e) => { if (e.key === "Escape") cancelConfirmPrompt() }}
		>
			<div class="modal confirm-prompt-modal">
				<h3>{confirmPromptTitle}</h3>
				<p>{confirmPromptMessage}</p>
				<div class="modal-actions">
					<Button type="button" variant="ghost" on:click={cancelConfirmPrompt}>Cancel</Button>
					<Button type="button" variant="danger" on:click={acceptConfirmPrompt}>Delete</Button>
				</div>
			</div>
		</div>
	{/if}

	{#if linkTrainerModalOpen}
		<div
			class="modal-backdrop"
			use:portal
			role="button"
			tabindex="-1"
			on:click={(e) => { if (e.target === e.currentTarget) closeLinkTrainerModal() }}
			on:keydown={(e) => { if (e.key === "Escape") closeLinkTrainerModal() }}
		>
			<div class="modal link-trainer-modal">
				<h3>Link Existing Trainer</h3>
				{#if linkTrainerError}
					<p class="link-trainer-error">{linkTrainerError}</p>
				{/if}
				<div class="link-trainer-list">
					{#if linkTrainerListLoading}
						<Loader />
					{:else if linkTrainerListValue}
						{#if linkTrainerListValue.length === 0}
							<p>No tenés entrenadores creados todavía.</p>
						{:else}
							<ul class="nolist no-space full-width">
								{#each linkTrainerListValue as t (t.readKey)}
									<li class="space-after">
										<button
											type="button"
											class="selectable-bubble trainer-bubble"
											disabled={linkTrainerSearching}
											on:click={() => selectLinkedTrainer(t)}
										>
											<span class="trainer-name">{t.name}</span>
											<span class="smaller-text">Lv. {t.level.data}</span>
										</button>
									</li>
								{/each}
							</ul>
						{/if}
					{:else if linkTrainerError}
						<p>{linkTrainerError}</p>
					{/if}
				</div>
				<div class="modal-actions">
					<Button type="button" variant="ghost" on:click={closeLinkTrainerModal}>Cancel</Button>
				</div>
			</div>
		</div>
	{/if}

</Page>

<style>
	nav {
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	.player-item {
		margin-bottom: 1em;
	}

	.player-fields {
		display: flex;
		gap: 1em;
	}

	.simple-type-field {
		display: flex;
		inline-size: 100%;
		align-items: center;
		gap: 1em;
		margin-bottom: 1em;
	}
	.simple-type-field :global(> *) {
		flex: 1;
	}

	.xp-awarded {
		margin-bottom: 0;
		margin-top: 1em;
	}

	.pokemon-list {
		display: flex;
		flex-direction: column;
		gap: 1em;
		padding: 1em 0 2em;
	}

	.pokemon-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		border-bottom: 1px solid var(--skin-bg-light);
		padding-bottom: 1em;
	}

	.pokemon-data {
		display: flex;
	}

	.pokemon-info > p {
		margin-bottom: 0;
	}

	.pokemon-name {
		font-size: 1.2em;
		font-weight: bold;
	}
	.pokemon-level {
		font-weight: normal;
		font-size: .8em;
	}
	.pokemon-level>input {
		width: 40px;
	}

	.pokemon-sprite {
		display: block;
		border: none;
		box-shadow: none;
		aspect-ratio: 1;
		object-fit: contain;
		width: 4em;
		padding-bottom: 1em;
	}

    .difficulty-badge {
        padding: 0.2em 0.8em;
        border-radius: 100px;
        color: var(--skin-bg-text);
        font-size: 0.9em;
        font-weight: bold;
        margin-left: 0.5em;
        text-transform: uppercase;
    }

	.no-matches {
		color: var(--skin-danger-text);
		font-style: italic;
	}

	.larger {
		font-size: var(--font-sz-neptune);
	}

	@media screen and (min-width: 50rem) {
		.pokemon-level>input {
			width: 65px;
		}
		.pokemon-sprite {
			width: 6em;
		}
		.pokemon-item {
			padding-bottom: 0;
		}
	}
	.preset-list {
		list-style: none;
		padding: 0;
		margin: 0 0 1em;
		display: flex;
		flex-direction: column;
		gap: 0.5em;
	}

	.preset-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		border: 1px solid var(--skin-bg-light);
		border-radius: 4px;
		padding: 0.75em 1em;
	}

	.preset-name {
		background: none;
		border: none;
		text-align: start;
		flex: 1;
		cursor: pointer;
		font-weight: bold;
	}

	.preset-menu-wrapper {
		position: relative;
	}

	.preset-menu-toggle {
		background: none;
		border: none;
		cursor: pointer;
		padding: 0.25em 0.5em;
		font-size: 1.2em;
	}

	.preset-menu {
		position: absolute;
		inset-inline-end: 0;
		top: 100%;
		z-index: 10;
		background: var(--skin-bg);
		border: 1px solid var(--skin-bg-light);
		border-radius: 4px;
		display: flex;
		flex-direction: column;
		min-width: 10em;
		box-shadow: 0 2px 8px rgba(0,0,0,0.2);
		color: #fff;
	}

	.preset-menu button {
		background: none;
		border: none;
		text-align: start;
		padding: 0.5em 0.75em;
		cursor: pointer;
		color: #fff;
	}
	.preset-menu button:hover {
		background: var(--skin-bg-light);
	}

	.summary-box {
		border: 1px solid var(--skin-bg-light);
		border-radius: 4px;
		padding: 1.25em;
		margin-bottom: 1em;
	}
	.summary-box p {
		margin: 0.25em 0;
	}

	.combat-order {
		border: 1px solid var(--skin-bg-light);
		border-radius: 4px;
		padding: 1.25em;
	}
	.combat-order li.trainer {
		font-weight: bold;
	}

	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
	}

	.modal {
		background: var(--skin-bg);
		border-radius: 8px;
		padding: 1.5em;
		min-width: 20em;
		max-width: 90vw;
		display: flex;
		flex-direction: column;
		gap: 1em;
	}

	.modal h3 {
		margin: 0;
	}

	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.75em;
	}
	.modal-actions :global(.button.ghost) {
		color: var(--skin-content-text);
		background-color: var(--skin-bg-text);
	}

	.modal h3,
	.modal h4 {
		margin: 0;
		color: #fff;
	}

	.summary-box p {
		margin: 0.25em 0;
		color: #fff;
	}

	.combat-order h4 {
		margin-top: 0;
		color: #fff;
	}

	.combat-order li {
		color: #fff;
	}

	.combat-order ol {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.4em;
	}

	.combat-order li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5em;
	}

	.combat-order li input {
		width: 4em;
	}

	.review-modal {
		max-width: 30em;
		max-height: 85vh;
		overflow-y: auto;
	}

	.modal :global(label) {
		color: #fff;
	}
	.side-by-side {
		display: flex;
		align-items: stretch;
		background-color: var(--skin-content);
		color: var(--skin-content-text);
		border-radius: 1.5em;
		box-shadow: var(--elev-cumulus);
		overflow: hidden;
	}

	.selectable-bubble {
		background: none;
		color: inherit;
		padding: 0.375em 0.5em;
		border: none;
		cursor: pointer;
		font: inherit;
		text-align: left;
		flex: 1;
		min-width: 0;
	}

	.selectable-bubble:hover,
	.selectable-bubble:focus,
	.selectable-bubble.selected {
		background-color: var(--skin-bg);
		color: var(--skin-bg-text);
	}

	.selectable-bubble.gridded {
		display: grid;
		grid-template-columns: 3em 1fr auto auto 2.75em;
		grid-template-areas:
			"sprite name name gender initiative"
			"sprite hpbar hpbar hpbar initiative"
			"sprite hp status lv initiative";
		gap: 0.125em;
		align-items: center;
	}

	.selectable-bubble.trainer-bubble {
		display: grid;
		grid-template-columns: 1fr 2.75em;
		grid-template-areas:
			"name initiative"
			"details initiative";
		gap: 0.25em;
		align-items: center;
		padding: 0.75em 0.9em;
	}

	.trainer-name {
		font-weight: bold;
	}

	.selectable-bubble .right {
		justify-self: end;
	}

	.selectable-bubble .away-from-edge {
		padding-right: 0.5em;
	}

	.selectable-bubble .flex {
		display: flex;
		align-items: center;
	}

	.selectable-bubble .max-height {
		max-height: 3em;
		display: block;
		position: relative;
	}

	.selectable-bubble .smaller-text {
		font-size: var(--font-sz-venus);
		opacity: 0.85;
	}

	.selectable-bubble .shadow {
		display: block;
		position: absolute;
		inset: auto 0.5em 0.25em 0.5em;
		block-size: 1em;
		background: oklch(0% 0 0 / 0.2);
		border-radius: 100%;
		z-index: 1;
	}

	.selectable-bubble .initiative {
		padding-left: 1em;
		font-weight: 800;
	}


	.selectable-bubble .jumping-animation > :global(img) {
		position: relative;
		z-index: 2;
	}

	.selectable-bubble:hover .jumping-animation > :global(img),
	.selectable-bubble:focus .jumping-animation > :global(img) {
		animation: jump 0.75s infinite;
	}

	@keyframes jump {
		0% { inset-block-start: 0; }
		15% { inset-block-start: -0.5em; }
		30% { inset-block-start: 0; }
		100% { inset-block-start: 0; }
	}

	@media (prefers-reduced-motion) {
		.selectable-bubble .jumping-animation > :global(img) {
			animation: none !important;
		}
	}


	.tracker-header-actions {
		display: flex;
		gap: 0.5em;
	}

	.add-pokemon-modal {
		width: min(50em, 95vw);
		max-width: none;
		height: 85vh;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		color: #fff;
	}

	.add-pokemon-modal :global(input),
	.add-pokemon-modal :global(select),
	.add-pokemon-modal :global(button) {
		color: inherit;
	}

	.add-pokemon-list {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		overflow-x: hidden;
	}


	.no-space {
		margin: 0;
	}

	.full-width {
		width: 100%;
	}

	.relative {
		position: relative;
		height: 0;
		flex: 1;
		margin-top: 0.5em;
	}

	.scrollable {
		height: 100%;
		overflow: auto;
	}

	.space-after {
		margin-bottom: 0.5em;
	}

	.nat-badge {
		display: inline-block;
		margin-left: 0.35em;
		font-size: 0.75em;
		font-weight: bold;
	}
	.nat-badge.nat20 { color: #ffd700; }
	.nat-badge.nat1 { color: #ff5c5c; }

	.advantage-note { color: #ffd700; font-weight: bold; }
	.disadvantage-note { color: #ff8080; font-weight: bold; }

	.active-pokemon-box {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.75em;
		margin-top: 0.75em;
		margin-bottom: 0.75em;
		padding: 0.6em 0.9em;
		border-radius: 24px;
	}

	.active-pokemon-info {
		display: flex;
		align-items: center;
		gap: 0.75em;
		min-width: 0;
	}

	.active-pokemon-sprite {
		display: block;
		width: 5em;
		height: 5em;
	}
	.active-pokemon-sprite :global(img) {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}

	.smaller-text {
		font-size: var(--font-sz-venus);
		opacity: 0.85;
	}

	.damage-modal {
		color: #fff;
	}

	.multiplier-note {
		font-weight: bold;
		margin: 0;
	}

	.computed-damage {
		margin: 0;
	}

	.status-style-action {
		font-size: var(--font-sz-venus);
		padding: 0.0625em 0.5em;
		border-radius: 1em;
		border: none;
		cursor: pointer;
		background: var(--skin-input-bg);
		color: inherit;
		font-family: inherit;
		white-space: nowrap;
	}

	.status-style-action:hover,
	.status-style-action:focus {
		background: var(--skin-input-bg);
		filter: brightness(1.15);
	}

	.confirm-prompt-modal p {
		margin: 0;
		color: #fff;
	}

	.players-actions {
		display: flex;
		gap: 0.75em;
	}

	.linked-note {
		font-size: var(--font-sz-venus);
		opacity: 0.85;
		margin: 0.25em 0 0;
	}

	.link-trainer-error {
		color: var(--skin-danger-text);
		margin: 0;
	}

	.link-trainer-modal {
		width: min(30em, 95vw);
		max-height: 80vh;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.link-trainer-list {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}

	.link-trainer-modal .selectable-bubble.trainer-bubble {
		width: 100%;
		background: #fff;
		color: #111;
		border-radius: 2em;
	}

	.link-trainer-modal .selectable-bubble.trainer-bubble:hover,
	.link-trainer-modal .selectable-bubble.trainer-bubble:focus {
		background: #eee;
		color: #111;
	}
</style>
