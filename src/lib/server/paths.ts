import path from 'node:path';

export type DataPaths = {
	root: string;
	dataDir: string;
	configPhp: string;
	configJson: string;
	database: string;
	seedDatabase: string;
};

export function dataPaths(root = process.cwd()): DataPaths {
	return {
		root,
		dataDir: path.join(root, 'data'),
		configPhp: path.join(root, 'data', 'config.php'),
		configJson: path.join(root, 'data', 'config.json'),
		database: path.join(root, 'data', 'onenav.db3'),
		seedDatabase: path.join(root, 'db', 'onenav.simple.db3')
	};
}
