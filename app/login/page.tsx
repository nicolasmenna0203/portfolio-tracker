import { contrasenaHabilitada } from '@/lib/session';
import LoginCliente from './LoginCliente';

// El servidor decide si se muestra el formulario de contraseña: en producción
// está apagada y se entra solo con passkey (ADR 0037). El cliente no lo puede
// saber solo, y preguntarlo con un fetch demoraría el Face ID al abrir.
//
// Dinámica a propósito: prerenderizada, la decisión quedaría fija en el build,
// y un build promovido de preview a producción mostraría el formulario según
// las variables del preview mientras el servidor aplica las de producción.
export const dynamic = 'force-dynamic';

export default function LoginPage() {
  return <LoginCliente conContrasena={contrasenaHabilitada()} />;
}
