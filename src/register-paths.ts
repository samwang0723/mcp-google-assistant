import { register } from 'tsconfig-paths';
import { resolve } from 'path';

// Register TypeScript path mappings for runtime resolution
register({
  baseUrl: resolve(__dirname),
  paths: {
    '@/*': ['./*'],
    '@config/*': ['./config/*'],
    '@utils/*': ['./utils/*'],
    '@services/*': ['./services/*'],
  },
});
