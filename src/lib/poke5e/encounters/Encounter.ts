import { DynamicLeveler, Level } from "$lib/dnd/level"
import { MovesetGenerator } from "$lib/moves/MovesetGenerator"
import type { PokemonSpecies } from "$lib/poke5e/species"
import { provider as trainerProvider, type TrainerData } from "$lib/trainers/data"
import type { LearnedMove, WithWriteKey } from "$lib/trainers/types"
import { experienceAwarded } from "../experience"
import type { Move } from "$lib/moves/Move"
import { get } from "svelte/store"
import { Nature, StandardNatures } from "$lib/pokemon/nature"
import { PokemonGender } from "$lib/pokemon/gender"
import { PokemonTeraType } from "$lib/pokemon/types"
import { Speeds } from "$lib/dnd/movement"
import { Senses } from "$lib/dnd/senses"
import { Stab } from "$lib/pokemon/stab"
import { TagList } from "$lib/poke5e/tags"
import { experienceNeededAtLevel } from "$lib/poke5e/experience"
import type { TrainerPokemon } from "$lib/trainers/types"
import type { Data } from "$lib/DataClass"

export const uniqueId = () =>
	typeof crypto !== "undefined" && crypto.randomUUID
		? crypto.randomUUID()
		: Math.random().toString(36).slice(2)

export type InitiativeRoll = {
	natural: number,
	total: number,
}

export type ActivePokemon = {
	species: Data<PokemonSpecies>,
	level: number,
}

export type EncounterActor = {
	data: PokemonSpecies,
	level: number,
	count: number,
	initiative?: number,
	rolls?: InitiativeRoll[],
}

export type EncounterTrainer = {
	id: string,
	name: string,
	level: number,
	numberOfPokemon: number,
	initiative?: number,
	initiativeRoll?: InitiativeRoll,
	activePokemon?: ActivePokemon,
}

export type CombatCreature = {
	id: string,
	kind: "pokemon",
	species: PokemonSpecies,
	pokemon: TrainerPokemon,
	initiative: number,
	initiativeNatural: number,
}

export type CombatTrainerEntry = {
	id: string,
	kind: "trainer",
	name: string,
	level: number,
	numberOfPokemon: number,
	initiative: number,
	activePokemon?: { species: PokemonSpecies, level: number },
}



export type CombatCombatant = CombatCreature | CombatTrainerEntry

export type EncounterGenerationOptions = {
	pool: PokemonSpecies[],
	targetExp: number,
	pokemonLimit?: number,
	maxLevel?: number,
}

export type Encounter = {
	pokemon: EncounterActor[]
}

export const ENCOUNTER_SIZE_LIMIT = 20

export const Encounter = {
	createEmpty(): Encounter {
		return {
			pokemon: [],
		}
	},

	totalExp(encounter: Encounter): number {
		return encounter.pokemon.reduce((sum, p) => {
			const xp = experienceAwarded(p.level, p.data.sr.data)
			return sum + (isNaN(xp) ? 0 : xp) * p.count
		}, 0)
	},

	count(encounter: Encounter): number {
		return encounter.pokemon.reduce((sum, p) => {
			return sum + p.count
		}, 0)
	},

	addPokemon(encounter: Encounter, species: PokemonSpecies, level: number): Encounter {
		const existing = encounter.pokemon.find((poke) => poke.data.id.data === species.id.data)
		if (existing) {
			existing.count += 1
		} else {
			encounter.pokemon.push({ data: species, count: 1, level: level })
		}

		return {
			...encounter,
			pokemon: [...encounter.pokemon],
		}
	},

	removePokemon(encounter: Encounter, species: PokemonSpecies) {
		return {
			...encounter,
			pokemon: encounter.pokemon.filter((it) => it.data.id.data !== species.data.id),
		}
	},

	generate({
		pool,
		targetExp,
		pokemonLimit = Infinity,
		maxLevel = 20,
	}: EncounterGenerationOptions): Encounter {
		const encounter: Encounter = {
			pokemon: [],
		}

		let currentTotalExp = 0
		let currentPokemonCount = 0
		let attempts = 0
		const MAX_ATTEMPTS = 500
		
		// Choose between Pokémon in the pool
		while (attempts < MAX_ATTEMPTS) {
			attempts++

			if (currentPokemonCount >= pokemonLimit) break

			const remainingExp = targetExp - currentTotalExp
			if (remainingExp <= 0) break

			const possibleChoices = pool.map(pokemon => {
				const randomLevel = Math.max(pokemon.data.minLevel, Math.floor(Math.random() * maxLevel) + 1)
				const exp = experienceAwarded(randomLevel, Number(pokemon.data.sr))
				return { pokemon, level: randomLevel, exp }
			}).filter(opt => opt.exp <= remainingExp)

			if (possibleChoices.length === 0) {
				break
			}

			let chosen: { pokemon: PokemonSpecies, level: number, exp: number }

			if (pokemonLimit < Infinity) {
				const slotsLeft = pokemonLimit - currentPokemonCount
				const targetExpPerPoke = remainingExp / slotsLeft

				possibleChoices.sort((a, b) => 
					Math.abs(a.exp - targetExpPerPoke) - Math.abs(b.exp - targetExpPerPoke),
				)
				
				const topTier = possibleChoices.slice(0, 3)
				chosen = topTier[Math.floor(Math.random() * topTier.length)]
			} else {
				chosen = possibleChoices[Math.floor(Math.random() * possibleChoices.length)]
			}

			currentTotalExp += chosen.exp
			currentPokemonCount += 1

			Encounter.addPokemon(encounter, chosen.pokemon, chosen.level)
		}

		return encounter
	},

	async saveToTrainers(encounter: Encounter, possibleMoves: Move[]): Promise<TrainerData & WithWriteKey> {
		if (Encounter.count(encounter) === 0) {
			throw new Error("Cannot save an empty encounter. Please add pokémon to it.")
		}

		if (Encounter.count(encounter) > ENCOUNTER_SIZE_LIMIT) {
			throw new Error(`Cannot save encounter with more than ${ENCOUNTER_SIZE_LIMIT} pokémon.`)
		}

		const trainer = await trainerProvider.newTrainer({
			name: "Encounter",
			description: "Created using the encounter tool.",
			hp: {
				current: 1,
				max: 1,
			},
		})

		const pokemon = (await Promise.all(encounter.pokemon.map(async (pokemon) => {
			return await Promise.all(Array(pokemon.count).fill(0).map(async (_, i) => {
				const added = await trainerProvider.addPokemonToTeam(trainer.writeKey, trainer.info.readKey, trainer.info.id, pokemon.data, i)

				const targetLevel = new Level(pokemon.level)

				// STATS
				const withAdjustedStats = DynamicLeveler.adjustStats({
					hp: pokemon.data.hp,
					level: new Level(pokemon.data.minLevel),
					hitDice: pokemon.data.hitDice,
					attributes: pokemon.data.attributes,
				}, targetLevel)
	
				added.level = withAdjustedStats.level
				added.hp.current = withAdjustedStats.hp
				added.hp.max = withAdjustedStats.hp
				added.hitDice.current = withAdjustedStats.level.data
				added.hitDice.max = withAdjustedStats.level.data
				added.attributes = withAdjustedStats.attributes

				// ABILITIES
				const ability = pokemon.data.abilities.chooseRandom()
				added.abilities = ability ? [ability] : []
	
				await trainerProvider.updatePokemon(trainer.writeKey, trainer.info.readKey, added)

				// MOVES
				const chosenMoves = MovesetGenerator.chooseMoves(pokemon.data.moves, targetLevel)
				const learnedMoves: LearnedMove[] = chosenMoves.map((it) => {
					const matchingMove = possibleMoves?.find((moveData) => it === moveData.id)
					return {
						id: "",
						moveId: it,
						pp: {
							current: matchingMove?.pp ?? 5,
							max: matchingMove?.pp ?? 5,
						},
						notes: "",
					}
				})

				const updatedMoveset = await trainerProvider.updateMoveset(trainer.writeKey, trainer.info.readKey, added.id, learnedMoves)
				added.moves = updatedMoveset

				return added
			}))
		}))).flat()

		trainer.pokemon = pokemon

		return trainer
	},

	rollInitiative(modifier: number): InitiativeRoll {
		const natural = Math.floor(Math.random() * 20) + 1
		return { natural, total: natural + modifier }
	},

	buildOneCombatCreature(species: PokemonSpecies, level: number, initiative: number, initiativeNatural: number, possibleMoves: Move[], nicknameOverride?: string): CombatCreature {
		const targetLevel = new Level(level)

		const withAdjustedStats = DynamicLeveler.adjustStats({
			hp: species.data.hp,
			level: new Level(species.data.minLevel),
			hitDice: species.hitDice,
			attributes: species.attributes,
		}, targetLevel)

		const ability = species.abilities.chooseRandom()

		const chosenMoves = MovesetGenerator.chooseMoves(species.moves, targetLevel)
		const learnedMoves = chosenMoves.map((moveId) => {
			const matchingMove = possibleMoves?.find((moveData) => moveId === moveData.id)
			return {
				id: uniqueId(),
				moveId: moveId,
				pp: {
					current: matchingMove?.pp ?? 5,
					max: matchingMove?.pp ?? 5,
				},
				notes: "",
			}
		})

		const pokemon = {
			id: uniqueId(),
			trainerId: "combat-tracker",
			pokemonId: species.id,
			nickname: nicknameOverride ?? species.name,
			type: species.type,
			nature: new Nature(get(StandardNatures)[0]),
			level: withAdjustedStats.level,
			exp: experienceNeededAtLevel(withAdjustedStats.level.data),
			gender: PokemonGender.None,
			attributes: withAdjustedStats.attributes,
			ac: species.data.ac,
			ability: undefined,
			abilities: ability ? [ability] : [],
			hp: {
				current: withAdjustedStats.hp,
				max: withAdjustedStats.hp,
			},
			hitDice: {
				current: withAdjustedStats.level.data,
				max: withAdjustedStats.level.data,
			},
			proficiencies: species.skills.copy(),
			savingThrows: [...species.data.saves],
			moves: learnedMoves,
			items: [],
			notes: species.data.notes ?? "",
			teraType: new PokemonTeraType(species.type.primary),
			status: null,
			isShiny: false,
			feats: [],
			customSize: undefined,
			customHitDiceSize: undefined,
			speeds: new Speeds({}),
			senses: new Senses({}),
			bond: {
				level: 0,
				points: { current: 0, max: 0 },
			},
			stab: new Stab({ base: "default", bonus: 0 }),
			tags: TagList.empty(),
		} as unknown as TrainerPokemon

		return {
			id: pokemon.id,
			kind: "pokemon",
			species,
			pokemon,
			initiative,
			initiativeNatural,
		}
	},
} as const
