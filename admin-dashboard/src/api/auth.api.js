import { api } from './axios.js';

export const authApi = {
  login: ({ email, password }) =>
    api.post('/auth/login', { email, password }).then(r => r.data),

  me: () =>
    api.get('/auth/me').then(r => r.data),

  logout: () =>
    api.post('/auth/logout').then(r => r.data).catch(() => null),

  refresh: (refreshToken) =>
    api.post('/auth/refresh', { refreshToken }).then(r => r.data),
};
