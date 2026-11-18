import { migrateLegacyStorage } from '@/data/storageMigration'

// Imported before every other module of the app, because some read their saved settings the moment they load.
migrateLegacyStorage()
