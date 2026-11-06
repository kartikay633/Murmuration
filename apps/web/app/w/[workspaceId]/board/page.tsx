import type { Metadata } from 'next'
import { BoardView } from './view'

export const metadata: Metadata = { title: 'Board' }

export default function BoardPage() {
  return <BoardView />
}
