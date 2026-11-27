import { Lock } from 'lucide-react'
import { Notice } from './ui'
import { navigate } from '../hooks/useRoute'

/** Vises når en funksjon krever Business eller Business Plus. */
export function BusinessLocked({ what, plan = 'Business', loggedIn }: { what: string; plan?: 'Business' | 'Business Plus'; loggedIn: boolean }) {
  return (
    <Notice>
      <Lock size={14} /> {what} er med i {plan}{plan === 'Business' ? ' og Business Plus' : ''}.{' '}
      {loggedIn ? <button className="link" onClick={() => navigate('konto')}>Se abonnement</button> : null}
    </Notice>
  )
}
