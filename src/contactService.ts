import { pool } from './db';

interface Contact {
    id: number;
    phonenumber: string | null;
    email: string | null;
    linkedid: number | null;
    linkprecedence: 'primary' | 'secondary';
    createdat: Date;
    updatedat: Date;
    deletedat: Date | null;
}

export const findOrCreateContact = async (email?: string, phonenumber?: string) => {
    if(!email && !phonenumber) {
        return {
            error: "QUERY ERROR: Both email and phonenumber cannot be NULL"
        };
    }

    const client = await pool.connect();
    try {
        const contacts = await client.query<Contact>(
            'SELECT * FROM Contact WHERE email = $1 OR phonenumber = $2 ORDER BY createdat ASC',
                [email, phonenumber]
        );

        if(contacts.rows.length>0) {
            let primaryContacts = contacts.rows.filter(contact => contact.linkprecedence === 'primary');
            let secondaryContacts = contacts.rows.filter(contact => contact.linkprecedence === 'secondary');

            if(primaryContacts.length === 0) {
                const secondaryLinkedIds = new Set(secondaryContacts.map(contact => contact.linkedid).filter(id => id !== null));
                if(secondaryLinkedIds.size == 0) {
                    return {
                        error: "DB ERROR: Primary Contact Not Found"
                    }
                }

                const primary = [];
                for (const id of secondaryLinkedIds.values()) {
                    const result = await client.query<Contact>(
                        'SELECT * FROM Contact WHERE id = $1',
                            [id]
                    );
                    primary.push(result.rows[0]);
                }
                primaryContacts = primary;                
            }

            const primaryContact = primaryContacts[0];

            const linkedToPrimary = await client.query<Contact>(
                'SELECT * FROM Contact WHERE linkedid = $1',
                    [primaryContact.id]
            );
            linkedToPrimary.rows.forEach(row => {
                secondaryContacts.push(row);
            });

            const oldPrimary = [];
            for(let i=1; i<primaryContacts.length; ++i) {
                oldPrimary.push(client.query(
                    'UPDATE Contact SET linkedid = $1, linkprecedence = $2 WHERE id = $3 RETURNING *',
                        [primaryContact.id, 'secondary', primaryContacts[i].id]
                ));
            };
            const oldPrimaryNowSecondary = await Promise.all(oldPrimary);

            const updatesSecondary = [];
            for(let i=0; i<secondaryContacts.length; ++i) {
                updatesSecondary.push(client.query(
                    'UPDATE Contact SET linkedid = $1 WHERE id = $2',
                        [primaryContact.id, secondaryContacts[i].id]
                ));
            };
            await Promise.all(updatesSecondary);

            oldPrimaryNowSecondary.forEach(updatedContact => {
                secondaryContacts.push(updatedContact.rows[0]);
            });

            return {
                primaryContact,
                secondaryContacts
            };
        } else {
            const newContact = await client.query<Contact>(
                'INSERT INTO Contact (email, phonenumber, linkprecedence) VALUES ($1, $2, $3) RETURNING *',
                [email, phonenumber, 'primary']
            );

            console.log(newContact.rows[0]);

            return {
                primaryContact: newContact.rows[0],
                secondaryContacts: []
            };
        }
    }
    finally {
        client.release();
    }
};
