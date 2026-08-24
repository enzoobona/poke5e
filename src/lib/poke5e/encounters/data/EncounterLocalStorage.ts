import type { ReadWriteKey } from "$lib/trainers/types"

const STORAGE_KEY = "encounters"

const getReadKeys = (): ReadWriteKey[] =>
	localStorage.getItem(STORAGE_KEY)?.split(",")?.filter((it) => it !== "") ?? []

const addReadKey = (key: ReadWriteKey) => {
	const previous = getReadKeys()
	const newList = [...new Set(previous.concat(key))]
	localStorage.setItem(STORAGE_KEY, newList.join(","))
}

const removeReadKey = (key: ReadWriteKey) => {
	const previous = getReadKeys()
	localStorage.setItem(STORAGE_KEY, previous.filter((it) => it !== key).join(","))
}

const getWriteKey = (readKey: ReadWriteKey): ReadWriteKey | undefined =>
	localStorage.getItem(`encounter-write:${readKey}`) ?? undefined

const addWriteKey = (readKey: ReadWriteKey, writeKey: ReadWriteKey) => {
	localStorage.setItem(`encounter-write:${readKey}`, writeKey)
}

const removeWriteKey = (readKey: ReadWriteKey) => {
	localStorage.removeItem(`encounter-write:${readKey}`)
}

export const EncounterLocalStorage = {
	getReadKeys,
	addReadKey,
	removeReadKey,
	getWriteKey,
	addWriteKey,
	removeWriteKey,
} as const