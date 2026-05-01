import styles from '../styles/AddBrandModal.module.css';
import BrandManagement from './BrandManagement';

export default function AddBrandModal({ isOpen, onClose, onBrandAdded, onBrandUpdated }) {
    if (!isOpen) return null;

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div className={styles.modal} onClick={e => e.stopPropagation()}>
                <BrandManagement 
                    onBrandAdded={onBrandAdded}
                    onBrandUpdated={onBrandUpdated}
                    onClose={onClose}
                />
            </div>
        </div>
    );
}
