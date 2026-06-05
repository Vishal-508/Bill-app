import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useDispatch } from 'react-redux';
import { useNavigate, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Eye, EyeOff, LogIn } from 'lucide-react';
import { Card } from '../../components/ui/Card.jsx';
import { Input } from '../../components/ui/Input.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Checkbox } from '../../components/ui/Checkbox.jsx';
import { Alert } from '../../components/ui/Alert.jsx';
import { loginSchema } from '../../utils/validators.js';
import { loginThunk } from '../../store/auth.slice.js';
import { ROUTES } from '../../utils/constants.js';

export default function Login() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();

  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState(null);

  const {
    register, handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', rememberMe: true },
  });

  const onSubmit = async (data) => {
    setServerError(null);
    try {
      const result = await dispatch(
        loginThunk({ email: data.email, password: data.password })
      ).unwrap();

      const returnUrl = new URLSearchParams(location.search).get('returnUrl');
      navigate(returnUrl || ROUTES.DASHBOARD, { replace: true });
      toast.success(`Welcome back, ${result?.user?.name || result?.user?.email || 'Admin'}!`);
    } catch (err) {
      // rejectWithValue payload from loginThunk: { status, message }
      const status = err?.status;
      const apiMessage = err?.message;

      if (status === 401) {
        setServerError('Invalid email or password.');
      } else if (status === 429) {
        setServerError('Too many login attempts. Please wait a few minutes.');
      } else if (status === 403) {
        setServerError('Your account is inactive. Contact admin.');
      } else if (!status) {
        setServerError('Cannot reach server. Check your connection and try again.');
      } else {
        setServerError(apiMessage || 'Login failed. Please try again.');
      }
    }
  };

  return (
    <Card className="w-full max-w-md">
      <Card.Body className="px-6 py-8">
        <div className="text-center mb-6">
          <h1 className="text-xl font-semibold text-secondary-900">Sign in</h1>
          <p className="mt-1 text-sm text-secondary-500">
            Welcome back — use your admin credentials.
          </p>
        </div>

        {serverError && (
          <Alert variant="error" className="mb-4">
            {serverError}
          </Alert>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <Input
            label="Email"
            type="email"
            autoComplete="email"
            autoFocus
            placeholder="you@example.com"
            disabled={isSubmitting}
            error={errors.email?.message}
            required
            {...register('email')}
          />

          <Input
            label="Password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder="••••••••"
            disabled={isSubmitting}
            error={errors.password?.message}
            required
            suffix={
              <button
                type="button"
                onClick={() => setShowPassword(s => !s)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="text-secondary-400 hover:text-secondary-600 focus:outline-none"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            }
            {...register('password')}
          />

          <div className="flex items-center justify-between text-sm">
            <Checkbox
              label="Remember me"
              disabled={isSubmitting}
              {...register('rememberMe')}
            />
            <button
              type="button"
              className="text-primary-600 hover:text-primary-700 text-xs"
              onClick={() => toast('Contact admin to reset your password.', { icon: 'ℹ️' })}
            >
              Forgot password?
            </button>
          </div>

          <Button
            type="submit"
            variant="primary"
            fullWidth
            loading={isSubmitting}
            disabled={isSubmitting}
            leftIcon={!isSubmitting && <LogIn size={16} />}
          >
            {isSubmitting ? 'Signing in…' : 'Sign In'}
          </Button>
        </form>
      </Card.Body>
    </Card>
  );
}
