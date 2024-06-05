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
        let contacts = await client.query<Contact>(
            'SELECT * FROM Contact WHERE email = $1 OR phonenumber = $2 ORDER BY createdat ASC',
                [email, phonenumber]
        );

        let countEmail = 0;
        let countPhone = 0;

        contacts.rows.forEach(contact => {
            if (contact.email === email) {
                countEmail++;
            }
            if (contact.phonenumber === phonenumber) {
                countPhone++;
            }
        });

        if(contacts.rows.length>0) {
            let primaryContacts = contacts.rows.filter(contact => contact.linkprecedence === 'primary');
            let secondaryContactsSet = new Set<number>(contacts.rows.filter(contact => contact.linkprecedence === 'secondary').map(contact => contact.id));

            if(primaryContacts.length === 0) {
                let secondaryLinkedIds = new Set<number>(contacts.rows.filter(contact => contact.linkprecedence === 'secondary' && contact.linkedid !== null).map((contact: Contact) => contact.linkedid as number));
                if(secondaryLinkedIds.size === 0) {
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
            if(email !== "" && countEmail === 0) {
                const newContact = await client.query<Contact>(
                    'INSERT INTO Contact (email, phonenumber, linkprecedence, linkedid) VALUES ($1, $2, $3, $4) RETURNING *',
                    [email, phonenumber, 'secondary', primaryContact.id]
                );
                secondaryContactsSet.add(newContact.rows[0].id);
            }
            if(phonenumber !== "" && countPhone === 0) {
                const newContact = await client.query<Contact>(
                    'INSERT INTO Contact (email, phonenumber, linkprecedence, linkedid) VALUES ($1, $2, $3, $4) RETURNING *',
                    [email, phonenumber, 'secondary', primaryContact.id]
                );
                secondaryContactsSet.add(newContact.rows[0].id);
            }

            const linkedToPrimary = await client.query<Contact>(
                'SELECT * FROM Contact WHERE linkedid = $1',
                    [primaryContact.id]
            );
            linkedToPrimary.rows.forEach(row => {
                secondaryContactsSet.add(row.id);
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
            for(let id of secondaryContactsSet) {
                updatesSecondary.push(client.query(
                    'UPDATE Contact SET linkedid = $1 WHERE id = $2',
                        [primaryContact.id, id]
                ));
            };
            await Promise.all(updatesSecondary);

            oldPrimaryNowSecondary.forEach(updatedContact => {
                secondaryContactsSet.add(updatedContact.rows[0].id);
            });

            let secondaryContacts = [];
            for (let id of secondaryContactsSet) {
                const result = await client.query<Contact>('SELECT * FROM Contact WHERE id = $1', [id]);
                if (result.rows.length > 0) {
                    secondaryContacts.push(result.rows[0]);
                }
            }

            return {
                primaryContact,
                secondaryContacts
            };
        } else {
            const newContact = await client.query<Contact>(
                'INSERT INTO Contact (email, phonenumber, linkprecedence) VALUES ($1, $2, $3) RETURNING *',
                [email, phonenumber, 'primary']
            );

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
