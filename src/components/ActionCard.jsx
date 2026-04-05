import { useRef, useState } from 'react';
import styles from '../styles/ActionCard.module.css';

function ActionCard({ onSelect, disabled, title, iconText, hint, formats, accept, multiple }) {
    const fileInputRef = useRef(null);
    const [isDragging, setIsDragging] = useState(false);

    const handleDragOver = (e) => {
        e.preventDefault();
        if (!disabled) setIsDragging(true);
    };

    const handleDragLeave = (e) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = (e) => {
        e.preventDefault();
        setIsDragging(false);
        if (disabled) return;
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFiles(multiple ? Array.from(files) : files[0]);
        }
    };

    const handleFileInput = (e) => {
        if (e.target.files.length > 0) {
            handleFiles(multiple ? Array.from(e.target.files) : e.target.files[0]);
        }
        // Always reset input so same file can be selected twice
        e.target.value = '';
    };

    const handleFiles = (fileOrFiles) => {
        if (!onSelect) return;
        onSelect(fileOrFiles);
    };

    const handleClick = () => {
        if (disabled) return;
        if (accept || multiple) {
            fileInputRef.current?.click();
        } else if (onSelect) {
            onSelect();
        }
    };

    return (
        <div className={styles.uploadContainer}>
            <div
                className={`${styles.dropZone} ${isDragging ? styles.dragging : ''} ${disabled ? styles.disabled : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={handleClick}
            >
                <div className={styles.uploadIcon}>{iconText}</div>
                <h3 className={styles.uploadTitle}>
                    {disabled ? 'Processing...' : (title || 'ACTION')}
                </h3>
                <p className={styles.uploadHint}>
                    {hint || 'or click to browse'}
                </p>
                {formats && (
                    <p className={styles.uploadFormats}>
                        {formats}
                    </p>
                )}

                {(accept || multiple) && (
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept={accept}
                        multiple={multiple}
                        onChange={handleFileInput}
                        style={{ display: 'none' }}
                        disabled={disabled}
                    />
                )}
            </div>
        </div>
    );
}

export default ActionCard;
